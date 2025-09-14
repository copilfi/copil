// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAccountFactory
 * @dev Interface for the Account Factory contract
 */
interface IAccountFactory {
    /**
     * @dev Creates a new Smart Account for the given owner
     * @param owner The owner of the new Smart Account
     * @param salt Unique salt for CREATE2 deployment
     * @return account Address of the created Smart Account
     */
    function createAccount(address owner, bytes32 salt) external returns (address account);

    /**
     * @dev Computes the address of a Smart Account before deployment
     * @param owner The owner of the Smart Account
     * @param salt Unique salt for CREATE2 deployment
     * @return account Computed address of the Smart Account
     */
    function getAddress(address owner, bytes32 salt) external view returns (address account);

    /**
     * @dev Gets the Smart Account address for a given owner
     * @param owner The owner address
     * @return account The Smart Account address (zero if not created)
     */
    function getAccount(address owner) external view returns (address account);

    /**
     * @dev Checks if an address is a Smart Account created by this factory
     * @param account The address to check
     * @return True if the address is a Smart Account
     */
    function isAccount(address account) external view returns (bool);

    /**
     * @dev Batch create accounts for multiple owners
     * @param owners Array of owner addresses
     * @param salts Array of salts corresponding to each owner
     * @return accounts Array of created account addresses
     */
    function batchCreateAccounts(
        address[] calldata owners,
        bytes32[] calldata salts
    ) external returns (address[] memory accounts);
}