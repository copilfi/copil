// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ISmartAccount.sol";

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