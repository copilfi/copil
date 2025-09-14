// Standard ERC-4337 EntryPoint contract ABI (partial)
export const ENTRY_POINT_ABI = [
  {
    "type": "function",
    "name": "handleOps",
    "inputs": [
      {"name": "ops", "type": "tuple[]", "components": [
        {"name": "sender", "type": "address"},
        {"name": "nonce", "type": "uint256"},
        {"name": "initCode", "type": "bytes"},
        {"name": "callData", "type": "bytes"},
        {"name": "callGasLimit", "type": "uint256"},
        {"name": "verificationGasLimit", "type": "uint256"},
        {"name": "preVerificationGas", "type": "uint256"},
        {"name": "maxFeePerGas", "type": "uint256"},
        {"name": "maxPriorityFeePerGas", "type": "uint256"},
        {"name": "paymasterAndData", "type": "bytes"},
        {"name": "signature", "type": "bytes"}
      ]},
      {"name": "beneficiary", "type": "address"}
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getUserOpHash",
    "inputs": [{"name": "userOp", "type": "tuple", "components": [
      {"name": "sender", "type": "address"},
      {"name": "nonce", "type": "uint256"},
      {"name": "initCode", "type": "bytes"},
      {"name": "callData", "type": "bytes"},
      {"name": "callGasLimit", "type": "uint256"},
      {"name": "verificationGasLimit", "type": "uint256"},
      {"name": "preVerificationGas", "type": "uint256"},
      {"name": "maxFeePerGas", "type": "uint256"},
      {"name": "maxPriorityFeePerGas", "type": "uint256"},
      {"name": "paymasterAndData", "type": "bytes"},
      {"name": "signature", "type": "bytes"}
    ]}],
    "outputs": [{"name": "", "type": "bytes32"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getNonce",
    "inputs": [
      {"name": "sender", "type": "address"},
      {"name": "key", "type": "uint192"}
    ],
    "outputs": [{"name": "nonce", "type": "uint256"}],
    "stateMutability": "view"
  }
];

// AccountFactory ABI (simplified)
export const ACCOUNT_FACTORY_ABI = [
  {
    "type": "function",
    "name": "createAccount",
    "inputs": [
      {"name": "owner", "type": "address"},
      {"name": "salt", "type": "bytes32"}
    ],
    "outputs": [{"name": "account", "type": "address"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getAddress",
    "inputs": [
      {"name": "owner", "type": "address"},
      {"name": "salt", "type": "bytes32"}
    ],
    "outputs": [{"name": "account", "type": "address"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getAccount",
    "inputs": [{"name": "owner", "type": "address"}],
    "outputs": [{"name": "account", "type": "address"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isAccount",
    "inputs": [{"name": "account", "type": "address"}],
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AccountCreated",
    "inputs": [
      {"name": "owner", "type": "address", "indexed": true},
      {"name": "account", "type": "address", "indexed": true},
      {"name": "salt", "type": "bytes32", "indexed": true}
    ]
  }
];

// SmartAccount ABI (simplified)
export const SMART_ACCOUNT_ABI = [
  {
    "type": "function",
    "name": "execute",
    "inputs": [
      {"name": "dest", "type": "address"},
      {"name": "value", "type": "uint256"},
      {"name": "func", "type": "bytes"}
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeBatch",
    "inputs": [
      {"name": "dest", "type": "address[]"},
      {"name": "value", "type": "uint256[]"},
      {"name": "func", "type": "bytes[]"}
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeAutomated",
    "inputs": [
      {"name": "dest", "type": "address"},
      {"name": "value", "type": "uint256"},
      {"name": "func", "type": "bytes"},
      {"name": "sessionKey", "type": "address"}
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createSessionKey",
    "inputs": [
      {"name": "sessionKey", "type": "address"},
      {"name": "validUntil", "type": "uint256"},
      {"name": "limitAmount", "type": "uint256"},
      {"name": "allowedTargets", "type": "address[]"},
      {"name": "allowedFunctions", "type": "bytes4[]"}
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeSessionKey",
    "inputs": [{"name": "sessionKey", "type": "address"}],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [{"name": "", "type": "address"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getNonce",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view"
  }
];

// ConditionalOrderEngine ABI (simplified)
export const CONDITIONAL_ORDER_ENGINE_ABI = [
  {
    "type": "function",
    "name": "createOrder",
    "inputs": [
      {"name": "orderType", "type": "uint8"},
      {"name": "conditions", "type": "tuple[]", "components": [
        {"name": "conditionType", "type": "uint8"},
        {"name": "tokenAddress", "type": "address"},
        {"name": "targetValue", "type": "uint256"},
        {"name": "currentValue", "type": "uint256"},
        {"name": "isMet", "type": "bool"},
        {"name": "extraData", "type": "bytes"}
      ]},
      {"name": "inputToken", "type": "address"},
      {"name": "outputToken", "type": "address"},
      {"name": "inputAmount", "type": "uint256"},
      {"name": "minOutputAmount", "type": "uint256"},
      {"name": "deadline", "type": "uint256"},
      {"name": "targetContract", "type": "address"},
      {"name": "callData", "type": "bytes"},
      {"name": "requiresAllConditions", "type": "bool"}
    ],
    "outputs": [{"name": "orderId", "type": "uint256"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeOrder",
    "inputs": [{"name": "orderId", "type": "uint256"}],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelOrder",
    "inputs": [{"name": "orderId", "type": "uint256"}],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getOrder",
    "inputs": [{"name": "orderId", "type": "uint256"}],
    "outputs": [
      {"name": "owner", "type": "address"},
      {"name": "orderType", "type": "uint8"},
      {"name": "status", "type": "uint8"},
      {"name": "inputToken", "type": "address"},
      {"name": "inputAmount", "type": "uint256"},
      {"name": "deadline", "type": "uint256"}
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "OrderCreated",
    "inputs": [
      {"name": "orderId", "type": "uint256", "indexed": true},
      {"name": "owner", "type": "address", "indexed": true},
      {"name": "orderType", "type": "uint8"},
      {"name": "inputToken", "type": "address"},
      {"name": "inputAmount", "type": "uint256"}
    ]
  },
  {
    "type": "event",
    "name": "OrderExecuted",
    "inputs": [
      {"name": "orderId", "type": "uint256", "indexed": true},
      {"name": "executor", "type": "address", "indexed": true},
      {"name": "gasUsed", "type": "uint256"},
      {"name": "reward", "type": "uint256"}
    ]
  }
];

// Standard ERC-20 ABI
export const ERC20_ABI = [
  {
    "type": "function",
    "name": "name",
    "inputs": [],
    "outputs": [{"name": "", "type": "string"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [{"name": "", "type": "string"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "decimals",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint8"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
    "inputs": [],
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{"name": "account", "type": "address"}],
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      {"name": "to", "type": "address"},
      {"name": "amount", "type": "uint256"}
    ],
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allowance",
    "inputs": [
      {"name": "owner", "type": "address"},
      {"name": "spender", "type": "address"}
    ],
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {"name": "spender", "type": "address"},
      {"name": "amount", "type": "uint256"}
    ],
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      {"name": "from", "type": "address"},
      {"name": "to", "type": "address"},
      {"name": "amount", "type": "uint256"}
    ],
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {"name": "from", "type": "address", "indexed": true},
      {"name": "to", "type": "address", "indexed": true},
      {"name": "value", "type": "uint256"}
    ]
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      {"name": "owner", "type": "address", "indexed": true},
      {"name": "spender", "type": "address", "indexed": true},
      {"name": "value", "type": "uint256"}
    ]
  }
];

// Contract deployment bytecode hashes (for verification)
export const CONTRACT_HASHES = {
  ENTRY_POINT: '0x8a3a92c16bc4a4b52d93d1ad5d04df5c03d4d1e5d1f9e0a2d4c8b5e8f7a9b2d1',
  ACCOUNT_FACTORY: '', // Will be populated after deployment
  SMART_ACCOUNT: '', // Will be populated after deployment
  CONDITIONAL_ORDER_ENGINE: '', // Will be populated after deployment
};