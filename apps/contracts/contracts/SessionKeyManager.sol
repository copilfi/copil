// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SessionKeyManager
 * @dev Manages session keys for Smart Accounts with permission-based automation
 * @notice Session keys enable secure automation without exposing main private keys
 */
contract SessionKeyManager is Ownable, ReentrancyGuard {
    constructor() Ownable(msg.sender) {}
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // Session key data structure
    struct SessionKey {
        bool isActive;
        uint256 validUntil;
        uint256 limitAmount;
        uint256 spentAmount;
        uint256 usageCount;
        uint256 maxUsageCount;
        address[] allowedTargets;
        bytes4[] allowedFunctions;
        uint256 createdAt;
        uint256 lastUsedAt;
    }

    // Mapping: sessionKey => smartAccount => SessionKey data
    mapping(address => mapping(address => SessionKey)) public sessionKeys;
    
    // Mapping: smartAccount => sessionKey[]
    mapping(address => address[]) public accountSessionKeys;
    
    // Mapping: sessionKey => smartAccount[] (for batch operations)
    mapping(address => address[]) public sessionKeyAccounts;

    // Events
    event SessionKeyCreated(
        address indexed sessionKey,
        address indexed smartAccount,
        uint256 validUntil,
        uint256 limitAmount
    );
    
    event SessionKeyRevoked(
        address indexed sessionKey,
        address indexed smartAccount
    );
    
    event SessionKeyUsed(
        address indexed sessionKey,
        address indexed smartAccount,
        address target,
        uint256 amount
    );
    
    event AllSessionKeysRevoked(address indexed smartAccount);

    /**
     * @dev Creates a new session key for a Smart Account
     * @param sessionKey Address of the session key
     * @param smartAccount Address of the Smart Account
     * @param validUntil Expiration timestamp
     * @param limitAmount Maximum amount this key can spend (in wei)
     * @param allowedTargets Allowed contract addresses
     * @param allowedFunctions Allowed function selectors
     */
    function createSessionKey(
        address sessionKey,
        address smartAccount,
        uint256 validUntil,
        uint256 limitAmount,
        address[] calldata allowedTargets,
        bytes4[] calldata allowedFunctions
    ) external {
        require(sessionKey != address(0), "SessionKeyManager: Invalid session key");
        require(smartAccount != address(0), "SessionKeyManager: Invalid smart account");
        require(validUntil > block.timestamp, "SessionKeyManager: Invalid expiration");
        require(limitAmount > 0, "SessionKeyManager: Invalid limit amount");
        require(allowedTargets.length > 0, "SessionKeyManager: No allowed targets");
        require(allowedFunctions.length > 0, "SessionKeyManager: No allowed functions");

        // Ensure session key doesn't already exist for this account
        require(
            !sessionKeys[sessionKey][smartAccount].isActive,
            "SessionKeyManager: Session key already exists"
        );

        // Store session key data
        sessionKeys[sessionKey][smartAccount] = SessionKey({
            isActive: true,
            validUntil: validUntil,
            limitAmount: limitAmount,
            spentAmount: 0,
            usageCount: 0,
            maxUsageCount: 1000, // Default max usage
            allowedTargets: allowedTargets,
            allowedFunctions: allowedFunctions,
            createdAt: block.timestamp,
            lastUsedAt: 0
        });

        // Add to tracking arrays
        accountSessionKeys[smartAccount].push(sessionKey);
        sessionKeyAccounts[sessionKey].push(smartAccount);

        emit SessionKeyCreated(sessionKey, smartAccount, validUntil, limitAmount);
    }

    /**
     * @dev Revokes a session key for a specific Smart Account
     * @param sessionKey Session key to revoke
     * @param smartAccount Smart Account address
     */
    function revokeSessionKey(address sessionKey, address smartAccount) external {
        require(
            sessionKeys[sessionKey][smartAccount].isActive,
            "SessionKeyManager: Session key not active"
        );

        sessionKeys[sessionKey][smartAccount].isActive = false;

        // Remove from tracking arrays
        _removeFromArray(accountSessionKeys[smartAccount], sessionKey);
        _removeFromArray(sessionKeyAccounts[sessionKey], smartAccount);

        emit SessionKeyRevoked(sessionKey, smartAccount);
    }

    /**
     * @dev Revokes all session keys for a Smart Account (emergency function)
     * @param smartAccount Smart Account address
     */
    function revokeAllSessionKeys(address smartAccount) external {
        address[] memory keys = accountSessionKeys[smartAccount];
        
        for (uint256 i = 0; i < keys.length; i++) {
            if (sessionKeys[keys[i]][smartAccount].isActive) {
                sessionKeys[keys[i]][smartAccount].isActive = false;
                _removeFromArray(sessionKeyAccounts[keys[i]], smartAccount);
            }
        }

        // Clear the array
        delete accountSessionKeys[smartAccount];

        emit AllSessionKeysRevoked(smartAccount);
    }

    /**
     * @dev Checks if a session key is valid for a Smart Account
     * @param sessionKey Session key address
     * @param smartAccount Smart Account address
     * @return True if valid
     */
    function isValidSessionKey(address sessionKey, address smartAccount) 
        external 
        view 
        returns (bool) 
    {
        SessionKey storage key = sessionKeys[sessionKey][smartAccount];
        
        return key.isActive && 
               block.timestamp <= key.validUntil &&
               key.usageCount < key.maxUsageCount;
    }

    /**
     * @dev Checks if a session key can execute a specific operation
     * @param target Target contract address
     * @param callData Call data containing function selector
     * @return True if operation is allowed
     */
    function canExecute(
        address /* sessionKey */,
        address target,
        bytes calldata callData
    ) external view returns (bool) {
        SessionKey storage key = sessionKeys[msg.sender][target];
        
        if (!key.isActive || block.timestamp > key.validUntil) {
            return false;
        }

        // Check if target is allowed
        bool targetAllowed = false;
        for (uint256 i = 0; i < key.allowedTargets.length; i++) {
            if (key.allowedTargets[i] == target) {
                targetAllowed = true;
                break;
            }
        }
        
        if (!targetAllowed) {
            return false;
        }

        // Check if function is allowed
        if (callData.length < 4) {
            return false;
        }

        bytes4 functionSelector = bytes4(callData[:4]);
        bool functionAllowed = false;
        
        for (uint256 i = 0; i < key.allowedFunctions.length; i++) {
            if (key.allowedFunctions[i] == functionSelector) {
                functionAllowed = true;
                break;
            }
        }

        return functionAllowed;
    }

    /**
     * @dev Validates a session key signature for user operations
     * @param sessionKey Session key that signed
     * @param smartAccount Smart Account address
     * @param callData Operation call data
     * @param signature The signature to validate
     * @return True if signature is valid
     */
    function validateSessionKeySignature(
        address sessionKey,
        address smartAccount,
        bytes calldata callData,
        bytes calldata signature
    ) external view returns (bool) {
        if (!this.isValidSessionKey(sessionKey, smartAccount)) {
            return false;
        }

        // Create message hash
        bytes32 messageHash = keccak256(
            abi.encodePacked(smartAccount, callData, block.chainid)
        ).toEthSignedMessageHash();

        // Recover signer
        address recovered = messageHash.recover(signature);
        
        return recovered == sessionKey;
    }

    /**
     * @dev Updates session key usage statistics
     * @param sessionKey Session key address
     */
    function updateUsage(address sessionKey) external {
        // Find the smart account for this session key (caller should be smart account)
        SessionKey storage key = sessionKeys[sessionKey][msg.sender];
        
        require(key.isActive, "SessionKeyManager: Session key not active");
        
        key.usageCount++;
        key.lastUsedAt = block.timestamp;

        emit SessionKeyUsed(sessionKey, msg.sender, address(0), 0);
    }

    /**
     * @dev Updates spending amount for a session key
     * @param sessionKey Session key address
     * @param amount Amount spent
     */
    function updateSpending(address sessionKey, uint256 amount) external {
        SessionKey storage key = sessionKeys[sessionKey][msg.sender];
        
        require(key.isActive, "SessionKeyManager: Session key not active");
        require(
            key.spentAmount + amount <= key.limitAmount,
            "SessionKeyManager: Spending limit exceeded"
        );
        
        key.spentAmount += amount;

        emit SessionKeyUsed(sessionKey, msg.sender, address(0), amount);
    }

    /**
     * @dev Gets session key data
     * @param sessionKey Session key address
     * @param smartAccount Smart Account address
     * @return isActive Whether the session key is active
     * @return validUntil Expiration timestamp
     * @return limitAmount Maximum spending limit
     * @return spentAmount Amount already spent
     * @return usageCount Number of times used
     * @return allowedTargets Allowed contract addresses
     * @return allowedFunctions Allowed function selectors
     */
    function getSessionKey(address sessionKey, address smartAccount) 
        external 
        view 
        returns (
            bool isActive,
            uint256 validUntil,
            uint256 limitAmount,
            uint256 spentAmount,
            uint256 usageCount,
            address[] memory allowedTargets,
            bytes4[] memory allowedFunctions
        ) 
    {
        SessionKey storage key = sessionKeys[sessionKey][smartAccount];
        
        return (
            key.isActive,
            key.validUntil,
            key.limitAmount,
            key.spentAmount,
            key.usageCount,
            key.allowedTargets,
            key.allowedFunctions
        );
    }

    /**
     * @dev Gets all session keys for a Smart Account
     * @param smartAccount Smart Account address
     * @return Array of session key addresses
     */
    function getAccountSessionKeys(address smartAccount) 
        external 
        view 
        returns (address[] memory) 
    {
        return accountSessionKeys[smartAccount];
    }

    /**
     * @dev Gets session key statistics
     * @param sessionKey Session key address
     * @param smartAccount Smart Account address
     * @return createdAt lastUsedAt usageCount spentAmount
     */
    function getSessionKeyStats(address sessionKey, address smartAccount)
        external
        view
        returns (uint256 createdAt, uint256 lastUsedAt, uint256 usageCount, uint256 spentAmount)
    {
        SessionKey storage key = sessionKeys[sessionKey][smartAccount];
        return (key.createdAt, key.lastUsedAt, key.usageCount, key.spentAmount);
    }

    /**
     * @dev Internal function to remove address from array
     * @param array Array to modify
     * @param addr Address to remove
     */
    function _removeFromArray(address[] storage array, address addr) internal {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == addr) {
                array[i] = array[array.length - 1];
                array.pop();
                break;
            }
        }
    }

    /**
     * @dev Emergency pause function (only owner)
     */
    function pause() external onlyOwner {
        // Implementation would pause all operations
    }

    /**
     * @dev Emergency unpause function (only owner)
     */
    function unpause() external onlyOwner {
        // Implementation would resume operations
    }
}