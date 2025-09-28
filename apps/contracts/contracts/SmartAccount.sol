// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/samples/callback/TokenCallbackHandler.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "./SessionKeyManager.sol";
import "./interfaces/ISmartAccount.sol";

/**
 * @title SmartAccount
 * @dev ERC-4337 compatible Smart Account with session key support for DeFi automation
 * @notice This contract allows users to automate DeFi operations without exposing private keys
 */
contract SmartAccount is
    ISmartAccount,
    BaseAccount,
    TokenCallbackHandler,
    UUPSUpgradeable,
    Initializable,
    ReentrancyGuard
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // State variables
    address private _owner;
    SessionKeyManager public sessionKeyManager;
    uint256 private _nonce;
    
    // Emergency recovery
    mapping(address => bool) public guardians;
    uint256 public guardiansCount;
    uint256 public recoveryThreshold;
    
    // Execution tracking
    mapping(bytes32 => bool) public executedOperations;
    
    // Events
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event GuardianAdded(address indexed guardian);
    event GuardianRemoved(address indexed guardian);
    event EmergencyRecovery(address indexed newOwner, address[] guardians);
    event OperationExecuted(bytes32 indexed operationHash, bool success);

    // Modifiers
    modifier onlyOwnerOrSessionKey() {
        require(
            msg.sender == _owner || 
            sessionKeyManager.isValidSessionKey(msg.sender, address(this)),
            "SmartAccount: Not authorized"
        );
        _;
    }

    modifier onlyOwnerOrEntryPoint() {
        require(
            msg.sender == _owner || msg.sender == address(entryPoint()),
            "SmartAccount: Not owner or EntryPoint"
        );
        _;
    }

    IEntryPoint private immutable _entryPoint;
    
    constructor(IEntryPoint anEntryPoint) {
        _entryPoint = anEntryPoint;
        _disableInitializers();
    }
    
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }

    /**
     * @dev Initializer function (called by factory)
     * @param anOwner The owner of this Smart Account
     */
    function initialize(address anOwner) public initializer {
        require(anOwner != address(0), "SmartAccount: Invalid owner");
        
        _owner = anOwner;
        
        // Deploy session key manager
        sessionKeyManager = new SessionKeyManager();
        
        // Set up emergency recovery (2 of 3 threshold)
        recoveryThreshold = 2;
        
        emit OwnershipTransferred(address(0), anOwner);
    }

    /**
     * @dev Returns the owner of the Smart Account
     */
    function owner() public view returns (address) {
        return _owner;
    }

    /**
     * @dev Returns the current nonce for this account
     */
    function getNonce() public view override(BaseAccount, ISmartAccount) returns (uint256) {
        return entryPoint().getNonce(address(this), 0);
    }

    /**
     * @dev Validates a user operation signature
     * @param userOp The user operation to validate
     * @param userOpHash Hash of the user operation
     * @return validationData Validation result (0 for success)
     */
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view override returns (uint256 validationData) {
        bytes32 hash = userOpHash.toEthSignedMessageHash();
        
        // Try owner signature first
        address recovered = hash.recover(userOp.signature);
        if (recovered == _owner) {
            return 0; // Success
        }
        
        // Check session key signatures
        if (sessionKeyManager.validateSessionKeySignature(
            recovered,
            address(this),
            userOp.callData,
            userOp.signature
        )) {
            return 0; // Success
        }
        
        return 1; // SIG_VALIDATION_FAILED
    }

    /**
     * @dev Executes a transaction (called by EntryPoint or owner)
     * @param dest Destination address
     * @param value ETH value to send
     * @param func Function call data
     */
    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external onlyOwnerOrEntryPoint nonReentrant {
        _call(dest, value, func);
    }

    /**
     * @dev Executes multiple transactions in batch
     * @param dest Array of destination addresses
     * @param value Array of ETH values to send
     * @param func Array of function call data
     */
    function executeBatch(
        address[] calldata dest,
        uint256[] calldata value,
        bytes[] calldata func
    ) external onlyOwnerOrEntryPoint nonReentrant {
        require(
            dest.length == func.length && 
            (value.length == 0 || value.length == func.length),
            "SmartAccount: Array length mismatch"
        );
        
        for (uint256 i = 0; i < dest.length; i++) {
            _call(dest[i], value.length == 0 ? 0 : value[i], func[i]);
        }
    }

    /**
     * @dev Executes an automated operation using session key
     * @param dest Destination address
     * @param value ETH value to send
     * @param func Function call data
     * @param sessionKey Session key that should execute this
     */
    function executeAutomated(
        address dest,
        uint256 value,
        bytes calldata func,
        address sessionKey
    ) external nonReentrant {
        bool callerIsSessionKey = msg.sender == sessionKey;
        bool callerIsEntryPoint = msg.sender == address(entryPoint());
        require(
            callerIsSessionKey || callerIsEntryPoint,
            "SmartAccount: Caller not authorized"
        );

        require(
            sessionKeyManager.isValidSessionKey(sessionKey, address(this)),
            "SmartAccount: Invalid session key"
        );
        
        require(
            sessionKeyManager.canExecute(sessionKey, address(this), dest, func),
            "SmartAccount: Session key cannot execute this operation"
        );
        
        // Create operation hash for tracking
        bytes32 operationHash = keccak256(
            abi.encodePacked(dest, value, func, block.timestamp)
        );
        
        require(!executedOperations[operationHash], "SmartAccount: Operation already executed");
        executedOperations[operationHash] = true;
        
        bool success = _call(dest, value, func);
        require(success, "SmartAccount: Automated call failed");

        // Update session key usage
        if (value > 0) {
            sessionKeyManager.updateSpending(sessionKey, value);
        }
        sessionKeyManager.updateUsage(sessionKey);
        
        emit OperationExecuted(operationHash, success);
    }

    /**
     * @dev Creates a new session key for automation
     * @param sessionKey Address of the session key
     * @param validUntil Expiration timestamp
     * @param limitAmount Maximum amount this key can spend
     * @param allowedTargets Allowed contract addresses
     * @param allowedFunctions Allowed function selectors
     */
    function createSessionKey(
        address sessionKey,
        uint256 validUntil,
        uint256 limitAmount,
        address[] calldata allowedTargets,
        bytes4[] calldata allowedFunctions
    ) external {
        require(msg.sender == _owner, "SmartAccount: Only owner can create session keys");
        
        sessionKeyManager.createSessionKey(
            sessionKey,
            address(this),
            validUntil,
            limitAmount,
            allowedTargets,
            allowedFunctions
        );
    }

    /**
     * @dev Revokes a session key
     * @param sessionKey Session key to revoke
     */
    function revokeSessionKey(address sessionKey) external {
        require(msg.sender == _owner, "SmartAccount: Only owner can revoke session keys");
        sessionKeyManager.revokeSessionKey(sessionKey, address(this));
    }

    /**
     * @dev Adds a guardian for emergency recovery
     * @param guardian Guardian address to add
     */
    function addGuardian(address guardian) external {
        require(msg.sender == _owner, "SmartAccount: Only owner");
        require(guardian != address(0) && guardian != _owner, "SmartAccount: Invalid guardian");
        require(!guardians[guardian], "SmartAccount: Guardian already exists");
        
        guardians[guardian] = true;
        guardiansCount++;
        
        emit GuardianAdded(guardian);
    }

    /**
     * @dev Removes a guardian
     * @param guardian Guardian address to remove
     */
    function removeGuardian(address guardian) external {
        require(msg.sender == _owner, "SmartAccount: Only owner");
        require(guardians[guardian], "SmartAccount: Guardian does not exist");
        
        guardians[guardian] = false;
        guardiansCount--;
        
        emit GuardianRemoved(guardian);
    }

    /**
     * @dev Emergency recovery function (requires guardian signatures)
     * @param newOwner New owner address
     * @param guardianSignatures Array of guardian signatures
     */
    function emergencyRecovery(
        address newOwner,
        address[] calldata guardianAddresses,
        bytes[] calldata guardianSignatures
    ) external {
        require(newOwner != address(0), "SmartAccount: Invalid new owner");
        require(
            guardianAddresses.length >= recoveryThreshold,
            "SmartAccount: Insufficient guardians"
        );
        require(
            guardianAddresses.length == guardianSignatures.length,
            "SmartAccount: Array length mismatch"
        );
        
        bytes32 hash = keccak256(
            abi.encodePacked("EMERGENCY_RECOVERY", newOwner, address(this))
        ).toEthSignedMessageHash();
        
        uint256 validSignatures = 0;
        
        for (uint256 i = 0; i < guardianAddresses.length; i++) {
            address guardian = guardianAddresses[i];
            
            require(guardians[guardian], "SmartAccount: Not a guardian");
            
            // Check for duplicates in the submitted array
            for (uint256 j = 0; j < i; j++) {
                require(guardianAddresses[j] != guardian, "SmartAccount: Duplicate guardian");
            }
            
            address recovered = hash.recover(guardianSignatures[i]);
            if (recovered == guardian) {
                validSignatures++;
            }
        }
        
        require(
            validSignatures >= recoveryThreshold,
            "SmartAccount: Insufficient valid signatures"
        );
        
        address oldOwner = _owner;
        _owner = newOwner;
        
        // Revoke all session keys on recovery
        sessionKeyManager.revokeAllSessionKeys(address(this));
        
        emit EmergencyRecovery(newOwner, guardianAddresses);
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    /**
     * @dev Internal function to execute a call
     * @param target Target address
     * @param value ETH value
     * @param data Call data
     * @return success Whether the call succeeded
     */
    function _call(address target, uint256 value, bytes memory data) internal returns (bool success) {
        assembly {
            success := call(gas(), target, value, add(data, 0x20), mload(data), 0, 0)
        }
    }

    /**
     * @dev UUPS upgrade authorization
     * @param newImplementation New implementation address
     */
    function _authorizeUpgrade(address newImplementation) internal view override {
        require(msg.sender == _owner, "SmartAccount: Only owner can upgrade");
        (newImplementation); // Silence unused variable warning
    }

    /**
     * @dev Receives ETH
     */
    receive() external payable {}

    /**
     * @dev Fallback function
     */
    fallback() external payable {}
}
