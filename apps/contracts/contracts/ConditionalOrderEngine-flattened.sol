// Sources flattened with hardhat v2.26.3 https://hardhat.org

// SPDX-License-Identifier: MIT

// File @openzeppelin/contracts/utils/Context.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}


// File @openzeppelin/contracts/access/Ownable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}


// File @openzeppelin/contracts/utils/introspection/IERC165.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (utils/introspection/IERC165.sol)

pragma solidity >=0.4.16;

/**
 * @dev Interface of the ERC-165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[ERC].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[ERC section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}


// File @openzeppelin/contracts/interfaces/IERC165.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC165.sol)

pragma solidity >=0.4.16;


// File @openzeppelin/contracts/token/ERC20/IERC20.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (token/ERC20/IERC20.sol)

pragma solidity >=0.4.16;

/**
 * @dev Interface of the ERC-20 standard as defined in the ERC.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}


// File @openzeppelin/contracts/interfaces/IERC20.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC20.sol)

pragma solidity >=0.4.16;


// File @openzeppelin/contracts/interfaces/IERC1363.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.4.0) (interfaces/IERC1363.sol)

pragma solidity >=0.6.2;


/**
 * @title IERC1363
 * @dev Interface of the ERC-1363 standard as defined in the https://eips.ethereum.org/EIPS/eip-1363[ERC-1363].
 *
 * Defines an extension interface for ERC-20 tokens that supports executing code on a recipient contract
 * after `transfer` or `transferFrom`, or code on a spender contract after `approve`, in a single transaction.
 */
interface IERC1363 is IERC20, IERC165 {
    /*
     * Note: the ERC-165 identifier for this interface is 0xb0202a11.
     * 0xb0202a11 ===
     *   bytes4(keccak256('transferAndCall(address,uint256)')) ^
     *   bytes4(keccak256('transferAndCall(address,uint256,bytes)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256)')) ^
     *   bytes4(keccak256('transferFromAndCall(address,address,uint256,bytes)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256)')) ^
     *   bytes4(keccak256('approveAndCall(address,uint256,bytes)'))
     */

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferAndCall(address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the allowance mechanism
     * and then calls {IERC1363Receiver-onTransferReceived} on `to`.
     * @param from The address which you want to send tokens from.
     * @param to The address which you want to transfer to.
     * @param value The amount of tokens to be transferred.
     * @param data Additional data with no specified format, sent in call to `to`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function transferFromAndCall(address from, address to, uint256 value, bytes calldata data) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value) external returns (bool);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens and then calls {IERC1363Spender-onApprovalReceived} on `spender`.
     * @param spender The address which will spend the funds.
     * @param value The amount of tokens to be spent.
     * @param data Additional data with no specified format, sent in call to `spender`.
     * @return A boolean value indicating whether the operation succeeded unless throwing.
     */
    function approveAndCall(address spender, uint256 value, bytes calldata data) external returns (bool);
}


// File @openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (token/ERC20/utils/SafeERC20.sol)

pragma solidity ^0.8.20;


/**
 * @title SafeERC20
 * @dev Wrappers around ERC-20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    /**
     * @dev An operation with an ERC-20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /**
     * @dev Variant of {safeTransfer} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransfer(IERC20 token, address to, uint256 value) internal returns (bool) {
        return _callOptionalReturnBool(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /**
     * @dev Variant of {safeTransferFrom} that returns a bool instead of reverting if the operation is not successful.
     */
    function trySafeTransferFrom(IERC20 token, address from, address to, uint256 value) internal returns (bool) {
        return _callOptionalReturnBool(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     *
     * IMPORTANT: If the token implements ERC-7674 (ERC-20 with temporary allowance), and if the "client"
     * smart contract uses ERC-7674 to set temporary allowances, then the "client" smart contract should avoid using
     * this function. Performing a {safeIncreaseAllowance} or {safeDecreaseAllowance} operation on a token contract
     * that has a non-zero temporary allowance (for that particular owner-spender) will result in unexpected behavior.
     */
    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     *
     * NOTE: If the token implements ERC-7674, this function will not modify any temporary allowance. This function
     * only sets the "standard" allowance. Any temporary allowance will remain active, in addition to the value being
     * set here.
     */
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        bytes memory approvalCall = abi.encodeCall(token.approve, (spender, value));

        if (!_callOptionalReturnBool(token, approvalCall)) {
            _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, 0)));
            _callOptionalReturn(token, approvalCall);
        }
    }

    /**
     * @dev Performs an {ERC1363} transferAndCall, with a fallback to the simple {ERC20} transfer if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            safeTransfer(token, to, value);
        } else if (!token.transferAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} transferFromAndCall, with a fallback to the simple {ERC20} transferFrom if the target
     * has no code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * Reverts if the returned value is other than `true`.
     */
    function transferFromAndCallRelaxed(
        IERC1363 token,
        address from,
        address to,
        uint256 value,
        bytes memory data
    ) internal {
        if (to.code.length == 0) {
            safeTransferFrom(token, from, to, value);
        } else if (!token.transferFromAndCall(from, to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Performs an {ERC1363} approveAndCall, with a fallback to the simple {ERC20} approve if the target has no
     * code. This can be used to implement an {ERC721}-like safe transfer that rely on {ERC1363} checks when
     * targeting contracts.
     *
     * NOTE: When the recipient address (`to`) has no code (i.e. is an EOA), this function behaves as {forceApprove}.
     * Opposedly, when the recipient address (`to`) has code, this function only attempts to call {ERC1363-approveAndCall}
     * once without retrying, and relies on the returned value to be true.
     *
     * Reverts if the returned value is other than `true`.
     */
    function approveAndCallRelaxed(IERC1363 token, address to, uint256 value, bytes memory data) internal {
        if (to.code.length == 0) {
            forceApprove(token, to, value);
        } else if (!token.approveAndCall(to, value, data)) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturnBool} that reverts if call fails to meet the requirements.
     */
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        uint256 returnSize;
        uint256 returnValue;
        assembly ("memory-safe") {
            let success := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            // bubble errors
            if iszero(success) {
                let ptr := mload(0x40)
                returndatacopy(ptr, 0, returndatasize())
                revert(ptr, returndatasize())
            }
            returnSize := returndatasize()
            returnValue := mload(0)
        }

        if (returnSize == 0 ? address(token).code.length == 0 : returnValue != 1) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturn} that silently catches all reverts and returns a bool instead.
     */
    function _callOptionalReturnBool(IERC20 token, bytes memory data) private returns (bool) {
        bool success;
        uint256 returnSize;
        uint256 returnValue;
        assembly ("memory-safe") {
            success := call(gas(), token, 0, add(data, 0x20), mload(data), 0, 0x20)
            returnSize := returndatasize()
            returnValue := mload(0)
        }
        return success && (returnSize == 0 ? address(token).code.length > 0 : returnValue == 1);
    }
}


// File @openzeppelin/contracts/utils/Pausable.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.3.0) (utils/Pausable.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module which allows children to implement an emergency stop
 * mechanism that can be triggered by an authorized account.
 *
 * This module is used through inheritance. It will make available the
 * modifiers `whenNotPaused` and `whenPaused`, which can be applied to
 * the functions of your contract. Note that they will not be pausable by
 * simply including this module, only once the modifiers are put in place.
 */
abstract contract Pausable is Context {
    bool private _paused;

    /**
     * @dev Emitted when the pause is triggered by `account`.
     */
    event Paused(address account);

    /**
     * @dev Emitted when the pause is lifted by `account`.
     */
    event Unpaused(address account);

    /**
     * @dev The operation failed because the contract is paused.
     */
    error EnforcedPause();

    /**
     * @dev The operation failed because the contract is not paused.
     */
    error ExpectedPause();

    /**
     * @dev Modifier to make a function callable only when the contract is not paused.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    modifier whenNotPaused() {
        _requireNotPaused();
        _;
    }

    /**
     * @dev Modifier to make a function callable only when the contract is paused.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    modifier whenPaused() {
        _requirePaused();
        _;
    }

    /**
     * @dev Returns true if the contract is paused, and false otherwise.
     */
    function paused() public view virtual returns (bool) {
        return _paused;
    }

    /**
     * @dev Throws if the contract is paused.
     */
    function _requireNotPaused() internal view virtual {
        if (paused()) {
            revert EnforcedPause();
        }
    }

    /**
     * @dev Throws if the contract is not paused.
     */
    function _requirePaused() internal view virtual {
        if (!paused()) {
            revert ExpectedPause();
        }
    }

    /**
     * @dev Triggers stopped state.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     */
    function _pause() internal virtual whenNotPaused {
        _paused = true;
        emit Paused(_msgSender());
    }

    /**
     * @dev Returns to normal state.
     *
     * Requirements:
     *
     * - The contract must be paused.
     */
    function _unpause() internal virtual whenPaused {
        _paused = false;
        emit Unpaused(_msgSender());
    }
}


// File @openzeppelin/contracts/utils/ReentrancyGuard.sol@v5.4.0

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.1.0) (utils/ReentrancyGuard.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If EIP-1153 (transient storage) is available on the chain you're deploying at,
 * consider using {ReentrancyGuardTransient} instead.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}


// File contracts/interfaces/ISmartAccount.sol

// Original license: SPDX_License_Identifier: MIT
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


// File contracts/ConditionalOrderEngine.sol

// Original license: SPDX_License_Identifier: MIT
pragma solidity ^0.8.20;






/**
 * @title ConditionalOrderEngine
 * @dev Executes conditional orders based on market conditions and user-defined strategies
 * @notice This contract handles automated DeFi strategy execution with various trigger conditions
 */
contract ConditionalOrderEngine is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Order types
    enum OrderType {
        LIMIT_BUY,
        LIMIT_SELL,
        STOP_LOSS,
        TAKE_PROFIT,
        DCA,           // Dollar Cost Averaging
        GRID_TRADING,
        YIELD_HARVEST,
        REBALANCE,
        LIQUIDATION_PROTECTION
    }

    // Order status
    enum OrderStatus {
        ACTIVE,
        EXECUTED,
        CANCELLED,
        EXPIRED,
        FAILED
    }

    // Condition types for triggers
    enum ConditionType {
        PRICE_ABOVE,
        PRICE_BELOW,
        PRICE_CHANGE_PERCENT,
        TIME_BASED,
        VOLUME_THRESHOLD,
        LIQUIDITY_THRESHOLD,
        YIELD_THRESHOLD,
        CUSTOM_LOGIC
    }

    // Condition structure
    struct Condition {
        ConditionType conditionType;
        address tokenAddress;
        uint256 targetValue;
        uint256 currentValue;
        bool isMet;
        bytes extraData;
    }

    // Order structure
    struct ConditionalOrder {
        uint256 orderId;
        address owner;
        address smartAccount;
        OrderType orderType;
        OrderStatus status;
        Condition[] conditions;
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 minOutputAmount;
        uint256 maxGasPrice;
        uint256 deadline;
        uint256 createdAt;
        uint256 executedAt;
        address targetContract;
        bytes callData;
        uint256 executionReward;
        bool requiresAllConditions; // AND vs OR logic
    }

    // DCA specific data
    struct DCAData {
        uint256 frequency; // in seconds
        uint256 amountPerExecution;
        uint256 totalBudget;
        uint256 spentAmount;
        uint256 lastExecutionTime;
        uint256 executionCount;
        uint256 maxExecutions;
    }

    // Grid trading data
    struct GridData {
        uint256 upperPrice;
        uint256 lowerPrice;
        uint256 gridLevels;
        uint256 amountPerGrid;
        mapping(uint256 => bool) gridExecuted;
    }

    // State variables
    uint256 public nextOrderId;
    mapping(uint256 => ConditionalOrder) public orders;
    mapping(uint256 => DCAData) public dcaOrders;
    mapping(uint256 => GridData) public gridOrders;
    mapping(address => uint256[]) public userOrders;
    mapping(address => bool) public authorizedExecutors;
    
    // Fee structure
    uint256 public executionFeePercent = 50; // 0.5% in basis points
    uint256 public maxExecutionReward = 0.01 ether;
    address public feeRecipient;
    
    // Price oracle (simplified)
    mapping(address => uint256) public tokenPrices;
    mapping(address => address) public priceOracles;

    // Events
    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        OrderType orderType,
        address inputToken,
        uint256 inputAmount
    );
    
    event OrderExecuted(
        uint256 indexed orderId,
        address indexed executor,
        uint256 gasUsed,
        uint256 reward
    );
    
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
    event ConditionMet(uint256 indexed orderId, uint256 conditionIndex);
    event ExecutorAuthorized(address indexed executor);
    event ExecutorRevoked(address indexed executor);

    modifier onlyAuthorizedExecutor() {
        require(
            authorizedExecutors[msg.sender] || msg.sender == owner(),
            "ConditionalOrderEngine: Not authorized executor"
        );
        _;
    }

    modifier validOrder(uint256 orderId) {
        require(orderId < nextOrderId, "ConditionalOrderEngine: Invalid order ID");
        require(
            orders[orderId].status == OrderStatus.ACTIVE,
            "ConditionalOrderEngine: Order not active"
        );
        _;
    }

    constructor(address _feeRecipient) Ownable(msg.sender) {
        require(_feeRecipient != address(0), "ConditionalOrderEngine: Invalid fee recipient");
        feeRecipient = _feeRecipient;
        nextOrderId = 1;
    }

    /**
     * @dev Creates a new conditional order
     * @param orderType Type of the order
     * @param conditions Array of conditions that must be met
     * @param inputToken Token to be spent
     * @param outputToken Token to be received
     * @param inputAmount Amount of input token
     * @param minOutputAmount Minimum amount of output token expected
     * @param deadline Order expiration timestamp
     * @param targetContract Contract to call for execution
     * @param callData Call data for the target contract
     * @param requiresAllConditions Whether all conditions must be met (AND) or just one (OR)
     */
    function createOrder(
        OrderType orderType,
        Condition[] calldata conditions,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minOutputAmount,
        uint256 deadline,
        address targetContract,
        bytes calldata callData,
        bool requiresAllConditions
    ) external nonReentrant whenNotPaused returns (uint256 orderId) {
        require(conditions.length > 0, "ConditionalOrderEngine: No conditions provided");
        require(inputToken != address(0), "ConditionalOrderEngine: Invalid input token");
        require(inputAmount > 0, "ConditionalOrderEngine: Invalid input amount");
        require(deadline > block.timestamp, "ConditionalOrderEngine: Invalid deadline");

        orderId = nextOrderId++;
        
        ConditionalOrder storage order = orders[orderId];
        order.orderId = orderId;
        order.owner = msg.sender;
        order.smartAccount = msg.sender; // Assuming caller is smart account
        order.orderType = orderType;
        order.status = OrderStatus.ACTIVE;
        order.inputToken = inputToken;
        order.outputToken = outputToken;
        order.inputAmount = inputAmount;
        order.minOutputAmount = minOutputAmount;
        order.maxGasPrice = tx.gasprice * 2; // Allow 2x current gas price
        order.deadline = deadline;
        order.createdAt = block.timestamp;
        order.targetContract = targetContract;
        order.callData = callData;
        order.requiresAllConditions = requiresAllConditions;

        // Copy conditions
        for (uint256 i = 0; i < conditions.length; i++) {
            order.conditions.push(conditions[i]);
        }

        // Calculate execution reward
        order.executionReward = (inputAmount * executionFeePercent) / 10000;
        if (order.executionReward > maxExecutionReward) {
            order.executionReward = maxExecutionReward;
        }

        userOrders[msg.sender].push(orderId);

        emit OrderCreated(orderId, msg.sender, orderType, inputToken, inputAmount);

        return orderId;
    }

    /**
     * @dev Creates a DCA (Dollar Cost Averaging) order
     * @param inputToken Token to spend regularly
     * @param outputToken Token to buy regularly
     * @param totalBudget Total amount to spend over time
     * @param frequency How often to execute (in seconds)
     * @param maxExecutions Maximum number of executions
     * @param targetContract DEX contract to use
     * @param callDataTemplate Template for swap calls
     */
    function createDCAOrder(
        address inputToken,
        address outputToken,
        uint256 totalBudget,
        uint256 frequency,
        uint256 maxExecutions,
        address targetContract,
        bytes calldata callDataTemplate
    ) external nonReentrant whenNotPaused returns (uint256 orderId) {
        require(totalBudget > 0, "ConditionalOrderEngine: Invalid budget");
        require(frequency >= 3600, "ConditionalOrderEngine: Frequency too high"); // Min 1 hour
        require(maxExecutions > 0, "ConditionalOrderEngine: Invalid max executions");

        uint256 amountPerExecution = totalBudget / maxExecutions;
        require(amountPerExecution > 0, "ConditionalOrderEngine: Amount per execution too small");

        // Create time-based condition
        Condition[] memory conditions = new Condition[](1);
        conditions[0] = Condition({
            conditionType: ConditionType.TIME_BASED,
            tokenAddress: address(0),
            targetValue: frequency,
            currentValue: 0,
            isMet: false,
            extraData: ""
        });

        orderId = this.createOrder(
            OrderType.DCA,
            conditions,
            inputToken,
            outputToken,
            amountPerExecution,
            0, // No min output for DCA
            block.timestamp + (frequency * maxExecutions * 2), // Extended deadline
            targetContract,
            callDataTemplate,
            true
        );

        // Store DCA-specific data
        dcaOrders[orderId] = DCAData({
            frequency: frequency,
            amountPerExecution: amountPerExecution,
            totalBudget: totalBudget,
            spentAmount: 0,
            lastExecutionTime: 0,
            executionCount: 0,
            maxExecutions: maxExecutions
        });

        return orderId;
    }

    /**
     * @dev Executes a conditional order if conditions are met
     * @param orderId ID of the order to execute
     */
    function executeOrder(uint256 orderId) 
        external 
        nonReentrant 
        validOrder(orderId) 
        onlyAuthorizedExecutor 
        whenNotPaused 
    {
        ConditionalOrder storage order = orders[orderId];
        
        require(block.timestamp <= order.deadline, "ConditionalOrderEngine: Order expired");
        require(tx.gasprice <= order.maxGasPrice, "ConditionalOrderEngine: Gas price too high");

        // Check conditions
        bool canExecute = _checkConditions(orderId);
        require(canExecute, "ConditionalOrderEngine: Conditions not met");

        uint256 gasStart = gasleft();

        // Execute the order
        bool success = _executeOrderLogic(order);
        require(success, "ConditionalOrderEngine: Execution failed");

        // Update order status
        order.status = OrderStatus.EXECUTED;
        order.executedAt = block.timestamp;

        // Handle DCA specific logic
        if (order.orderType == OrderType.DCA) {
            _handleDCAExecution(orderId);
        }

        // Calculate and pay execution reward
        uint256 gasUsed = gasStart - gasleft();
        uint256 reward = _calculateExecutionReward(gasUsed, order.executionReward);
        
        if (reward > 0) {
            payable(msg.sender).transfer(reward);
        }

        emit OrderExecuted(orderId, msg.sender, gasUsed, reward);
    }

    /**
     * @dev Cancels an active order
     * @param orderId ID of the order to cancel
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        ConditionalOrder storage order = orders[orderId];
        
        require(
            msg.sender == order.owner || msg.sender == owner(),
            "ConditionalOrderEngine: Not authorized to cancel"
        );
        require(
            order.status == OrderStatus.ACTIVE,
            "ConditionalOrderEngine: Order not active"
        );

        order.status = OrderStatus.CANCELLED;

        emit OrderCancelled(orderId, msg.sender);
    }

    /**
     * @dev Updates token price (would be called by oracle in production)
     * @param token Token address
     * @param price New price
     */
    function updateTokenPrice(address token, uint256 price) external onlyOwner {
        tokenPrices[token] = price;
    }

    /**
     * @dev Checks if all conditions for an order are met
     * @param orderId Order ID to check
     * @return True if conditions allow execution
     */
    function _checkConditions(uint256 orderId) internal returns (bool) {
        ConditionalOrder storage order = orders[orderId];
        uint256 conditionsMet = 0;

        for (uint256 i = 0; i < order.conditions.length; i++) {
            Condition storage condition = order.conditions[i];
            bool isMet = false;

            if (condition.conditionType == ConditionType.PRICE_ABOVE) {
                uint256 currentPrice = tokenPrices[condition.tokenAddress];
                isMet = currentPrice >= condition.targetValue;
            } else if (condition.conditionType == ConditionType.PRICE_BELOW) {
                uint256 currentPrice = tokenPrices[condition.tokenAddress];
                isMet = currentPrice <= condition.targetValue;
            } else if (condition.conditionType == ConditionType.TIME_BASED) {
                if (order.orderType == OrderType.DCA) {
                    DCAData storage dcaData = dcaOrders[orderId];
                    isMet = block.timestamp >= dcaData.lastExecutionTime + dcaData.frequency;
                } else {
                    isMet = block.timestamp >= condition.targetValue;
                }
            }

            condition.isMet = isMet;
            if (isMet) {
                conditionsMet++;
                emit ConditionMet(orderId, i);
            }
        }

        if (order.requiresAllConditions) {
            return conditionsMet == order.conditions.length;
        } else {
            return conditionsMet > 0;
        }
    }

    /**
     * @dev Executes the actual order logic
     * @param order Order to execute
     * @return Success status
     */
    function _executeOrderLogic(ConditionalOrder storage order) internal returns (bool) {
        // Call the target contract with the specified call data
        (bool success,) = order.targetContract.call(order.callData);
        return success;
    }

    /**
     * @dev Handles DCA order execution logic
     * @param orderId DCA order ID
     */
    function _handleDCAExecution(uint256 orderId) internal {
        DCAData storage dcaData = dcaOrders[orderId];
        ConditionalOrder storage order = orders[orderId];

        dcaData.lastExecutionTime = block.timestamp;
        dcaData.executionCount++;
        dcaData.spentAmount += dcaData.amountPerExecution;

        // If max executions reached or budget exhausted, mark as completed
        if (dcaData.executionCount >= dcaData.maxExecutions || 
            dcaData.spentAmount >= dcaData.totalBudget) {
            order.status = OrderStatus.EXECUTED;
        } else {
            // Reset for next execution
            order.status = OrderStatus.ACTIVE;
        }
    }

    /**
     * @dev Calculates execution reward based on gas used
     * @param gasUsed Gas consumed during execution
     * @param maxReward Maximum reward allowed
     * @return Reward amount
     */
    function _calculateExecutionReward(uint256 gasUsed, uint256 maxReward) 
        internal 
        view 
        returns (uint256) 
    {
        uint256 gasReward = gasUsed * tx.gasprice * 2; // 2x gas compensation
        return gasReward < maxReward ? gasReward : maxReward;
    }

    /**
     * @dev Authorizes an address to execute orders
     * @param executor Address to authorize
     */
    function authorizeExecutor(address executor) external onlyOwner {
        authorizedExecutors[executor] = true;
        emit ExecutorAuthorized(executor);
    }

    /**
     * @dev Revokes executor authorization
     * @param executor Address to revoke
     */
    function revokeExecutor(address executor) external onlyOwner {
        authorizedExecutors[executor] = false;
        emit ExecutorRevoked(executor);
    }

    /**
     * @dev Gets order details
     * @param orderId Order ID
     * @return owner Order owner
     * @return orderType Type of order
     * @return status Current status
     * @return inputToken Input token address
     * @return inputAmount Input token amount
     * @return deadline Expiration timestamp
     */
    function getOrder(uint256 orderId) 
        external 
        view 
        returns (
            address owner,
            OrderType orderType,
            OrderStatus status,
            address inputToken,
            uint256 inputAmount,
            uint256 deadline
        ) 
    {
        ConditionalOrder storage order = orders[orderId];
        return (
            order.owner,
            order.orderType,
            order.status,
            order.inputToken,
            order.inputAmount,
            order.deadline
        );
    }

    /**
     * @dev Gets user's orders
     * @param user User address
     * @return Array of order IDs
     */
    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }

    /**
     * @dev Emergency pause function
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause function
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Withdraw accumulated fees
     */
    function withdrawFees() external onlyOwner {
        payable(feeRecipient).transfer(address(this).balance);
    }

    /**
     * @dev Receive function to accept ETH for execution rewards
     */
    receive() external payable {}
}
