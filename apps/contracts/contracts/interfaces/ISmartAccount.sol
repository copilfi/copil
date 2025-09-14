// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISmartAccount
 * @dev Interface for Smart Account contract
 */
interface ISmartAccount {
    /**
     * @dev Executes a transaction
     * @param dest Destination address
     * @param value ETH value to send
     * @param func Function call data
     */
    function execute(
        address dest,
        uint256 value,
        bytes calldata func
    ) external;

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
    ) external;

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
    ) external;

    /**
     * @dev Returns the owner of the Smart Account
     */
    function owner() external view returns (address);

    /**
     * @dev Returns the current nonce for this account
     */
    function getNonce() external view returns (uint256);

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
    ) external;

    /**
     * @dev Revokes a session key
     * @param sessionKey Session key to revoke
     */
    function revokeSessionKey(address sessionKey) external;

    /**
     * @dev Adds a guardian for emergency recovery
     * @param guardian Guardian address to add
     */
    function addGuardian(address guardian) external;

    /**
     * @dev Removes a guardian
     * @param guardian Guardian address to remove
     */
    function removeGuardian(address guardian) external;

    /**
     * @dev Emergency recovery function (requires guardian signatures)
     * @param newOwner New owner address
     * @param guardianAddresses Array of guardian addresses
     * @param guardianSignatures Array of guardian signatures
     */
    function emergencyRecovery(
        address newOwner,
        address[] calldata guardianAddresses,
        bytes[] calldata guardianSignatures
    ) external;
}