// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Create2.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./SmartAccount.sol";
import "./interfaces/IAccountFactory.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * @title AccountFactory
 * @dev Factory contract for creating Smart Accounts using CREATE2
 * @notice This factory creates deterministic Smart Account addresses for users
 */
contract AccountFactory is IAccountFactory, Ownable, ReentrancyGuard {
    // Smart Account implementation address
    address public immutable accountImplementation;
    
    // Entry Point contract address (ERC-4337)
    IEntryPoint public immutable entryPoint;
    
    // Mapping from owner address to Smart Account address
    mapping(address => address) public accounts;
    
    // Mapping to track if an address is a Smart Account created by this factory
    mapping(address => bool) public isSmartAccount;
    
    // Events
    event AccountCreated(
        address indexed owner,
        address indexed account,
        bytes32 indexed salt
    );
    
    event AccountImplementationUpdated(
        address indexed oldImplementation,
        address indexed newImplementation
    );

    /**
     * @dev Constructor
     * @param _entryPoint Address of the ERC-4337 Entry Point contract
     */
    constructor(IEntryPoint _entryPoint) Ownable(msg.sender) {
        require(address(_entryPoint) != address(0), "AccountFactory: Invalid entry point");
        
        entryPoint = _entryPoint;
        
        // Deploy the Smart Account implementation
        accountImplementation = address(new SmartAccount(_entryPoint));
        
        _transferOwnership(msg.sender);
    }

    /**
     * @dev Creates a new Smart Account for the given owner
     * @param owner The owner of the new Smart Account
     * @param salt Unique salt for CREATE2 deployment
     * @return account Address of the created Smart Account
     */
    function createAccount(
        address owner,
        bytes32 salt
    ) external nonReentrant returns (address account) {
        require(owner != address(0), "AccountFactory: Invalid owner");
        
        // Check if account already exists for this owner
        if (accounts[owner] != address(0)) {
            return accounts[owner];
        }
        
        // Compute the account address
        account = getAddress(owner, salt);
        
        // Check if account already exists at computed address
        if (account.code.length > 0) {
            require(
                isSmartAccount[account],
                "AccountFactory: Address already in use"
            );
            accounts[owner] = account;
            return account;
        }

        // Create the account using CREATE2
        bytes memory data = abi.encodeCall(SmartAccount.initialize, (owner));
        
        account = address(
            new ERC1967Proxy{salt: _getSalt(owner, salt)}(
                accountImplementation,
                data
            )
        );
        
        // Store the mapping
        accounts[owner] = account;
        isSmartAccount[account] = true;
        
        emit AccountCreated(owner, account, salt);
        
        return account;
    }

    /**
     * @dev Computes the address of a Smart Account before deployment
     * @param owner The owner of the Smart Account
     * @param salt Unique salt for CREATE2 deployment
     * @return account Computed address of the Smart Account
     */
    function getAddress(
        address owner,
        bytes32 salt
    ) public view returns (address account) {
        bytes memory data = abi.encodeCall(SmartAccount.initialize, (owner));
        
        bytes memory bytecode = abi.encodePacked(
            type(ERC1967Proxy).creationCode,
            abi.encode(accountImplementation, data)
        );
        
        account = Create2.computeAddress(
            _getSalt(owner, salt),
            keccak256(bytecode)
        );
    }

    /**
     * @dev Gets the Smart Account address for a given owner
     * @param owner The owner address
     * @return account The Smart Account address (zero if not created)
     */
    function getAccount(address owner) external view returns (address account) {
        return accounts[owner];
    }

    /**
     * @dev Checks if an address is a Smart Account created by this factory
     * @param account The address to check
     * @return True if the address is a Smart Account
     */
    function isAccount(address account) external view returns (bool) {
        return isSmartAccount[account];
    }

    /**
     * @dev Internal function to generate salt for CREATE2
     * @param owner The owner address
     * @param salt User-provided salt
     * @return Combined salt for CREATE2
     */
    function _getSalt(address owner, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, salt));
    }

    /**
     * @dev Emergency function to upgrade implementation (for security fixes only)
     * @param newImplementation New implementation address
     */
    function updateImplementation(address newImplementation) external onlyOwner {
        require(newImplementation != address(0), "AccountFactory: Invalid implementation");
        require(newImplementation != accountImplementation, "AccountFactory: Same implementation");
        
        // Verify it's a valid SmartAccount implementation
        require(
            address(SmartAccount(payable(newImplementation)).entryPoint()) == address(entryPoint),
            "AccountFactory: Invalid implementation"
        );
        
        emit AccountImplementationUpdated(accountImplementation, newImplementation);
        
        // Note: This only affects new deployments, existing accounts remain unchanged
    }

    /**
     * @dev Batch create accounts for multiple owners
     * @param owners Array of owner addresses
     * @param salts Array of salts corresponding to each owner
     * @return accountAddresses Array of created account addresses
     */
    function batchCreateAccounts(
        address[] calldata owners,
        bytes32[] calldata salts
    ) external returns (address[] memory accountAddresses) {
        require(owners.length == salts.length, "AccountFactory: Length mismatch");
        require(owners.length > 0, "AccountFactory: Empty arrays");
        require(owners.length <= 50, "AccountFactory: Too many accounts");
        
        accountAddresses = new address[](owners.length);
        
        for (uint256 i = 0; i < owners.length; i++) {
            accountAddresses[i] = this.createAccount(owners[i], salts[i]);
        }
        
        return accountAddresses;
    }
}
