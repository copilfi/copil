import os
import json
import logging
from web3 import Web3
from eth_account import Account
from dotenv import load_dotenv
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class ChainService:
    """
    Foundry-compatible blockchain service for interacting with WorkflowManager contract.
    Uses Web3.py for blockchain interactions instead of Brownie.
    
    UPDATED: Now using NEW FUJI TESTNET deployment (2024)
    """
    
    def __init__(self):
        # Load environment variables from backend/.env file
        backend_env = Path(__file__).parent / "../../.env"
        load_dotenv(backend_env)
        
        # Smart contracts project path
        self.project_path = Path(__file__).parent / "../../../smart_contracts"
        
        # NEW FUJI TESTNET CONFIGURATION (Updated deployment)
        self.network_name = "Avalanche Fuji Testnet"
        self.chain_id = 43113
        
        # Contract addresses from latest deployment (WorkflowManager v5 with Registrar support)
        # Use the address from settings if available, otherwise use the latest deployed address
        self.fuji_proxy_address = os.getenv("FUJI_WORKFLOW_MANAGER_ADDRESS") or os.getenv("WORKFLOW_MANAGER_CONTRACT_ADDRESS") or "0x2C0FE5b5Ed6ae5410D7857E9b4De1f214C6936c1"
        self.fuji_implementation_address = "0x347Fb1745D3F65F52D97e705ef2cE61F5bF13454"  # NEW V5 IMPLEMENTATION
        self.fuji_automation_registry = "0x819B58A646CDd8289275A87653a2aA4902b14fe6"  # Chainlink Registry
        self.fuji_automation_registrar = "0xD23D3D1b81711D75E1012211f1b65Cc7dBB474e2"  # Chainlink Registrar v2.3
        
        # Get RPC URL and private key from environment
        self.rpc_url = os.getenv("AVALANCHE_FUJI_RPC_URL")
        if not self.rpc_url:
            raise ValueError("AVALANCHE_FUJI_RPC_URL environment variable not set!")
        
        private_key = os.getenv("PRIVATE_KEY")
        if not private_key:
            raise ValueError("PRIVATE_KEY environment variable not set!")
            
        # Initialize Web3 connection
        self.w3 = Web3(Web3.HTTPProvider(self.rpc_url))
        if not self.w3.is_connected():
            raise ConnectionError(f"Failed to connect to {self.rpc_url}")
        
        # Verify we're on the correct network
        if self.w3.eth.chain_id != self.chain_id:
            raise ValueError(f"Wrong network! Expected Fuji (43113), got {self.w3.eth.chain_id}")
        
        # Initialize account from private key
        self.account = Account.from_key(private_key)
        logger.info(f"Initialized chain service for {self.network_name}")
        logger.info(f"Account: {self.account.address}")
        logger.info(f"Contract: {self.fuji_proxy_address}")
        
        # Load contract ABI and initialize contract instance
        self.workflow_manager_contract = self._load_contract()

    def _load_contract(self):
        """
        Load WorkflowManager contract ABI from Foundry build artifacts and initialize contract instance.
        Uses the NEW FUJI TESTNET proxy address.
        """
        # Use the hardcoded proxy address (latest deployment)
        contract_address = self.fuji_proxy_address
        
        # Load ABI from Foundry build artifacts
        abi_path = self.project_path / "out/WorkflowManager.sol/WorkflowManager.json"
        if not abi_path.exists():
            raise FileNotFoundError(f"Contract ABI not found at {abi_path}. Run 'forge build' first.")
        
        with open(abi_path, 'r') as f:
            contract_artifact = json.load(f)
            contract_abi = contract_artifact['abi']
        
        # Create contract instance using proxy address
        contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(contract_address),
            abi=contract_abi
        )
        
        logger.info(f"Loaded WorkflowManager contract at: {contract_address} (Fuji Testnet)")
        logger.info(f"Implementation: {self.fuji_implementation_address}")
        logger.info(f"Automation Registry: {self.fuji_automation_registry}")
        return contract

    def _send_transaction(self, contract_function, gas_limit: int = 500000) -> Dict[str, Any]:
        """
        Send a transaction to the blockchain with proper gas estimation and nonce management.
        """
        try:
            # Get current nonce
            nonce = self.w3.eth.get_transaction_count(self.account.address)
            
            # Build transaction with higher gas price for faster confirmation
            base_gas_price = self.w3.eth.gas_price
            boosted_gas_price = int(base_gas_price * 1.5)  # 50% higher gas price
            
            transaction = contract_function.build_transaction({
                'from': self.account.address,
                'nonce': nonce,
                'gasPrice': boosted_gas_price,
                'gas': gas_limit,
                'chainId': self.w3.eth.chain_id
            })
            
            logger.info(f"Using boosted gas price: {boosted_gas_price / 10**9:.2f} gwei (base: {base_gas_price / 10**9:.2f} gwei)")
            
            # Sign transaction
            signed_txn = self.account.sign_transaction(transaction)
            
            # Send transaction
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            
            # Wait for transaction receipt
            tx_receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
            
            if tx_receipt.status != 1:
                # Get detailed revert reason
                try:
                    self.w3.eth.call(transaction, tx_receipt.blockNumber)
                except Exception as revert_error:
                    logger.error(f"Transaction reverted: {revert_error}")
                    raise Exception(f"Transaction failed with status: {tx_receipt.status}. Revert reason: {revert_error}")
                
                raise Exception(f"Transaction failed with status: {tx_receipt.status}")
            
            return {
                "transaction_hash": tx_hash.hex(),
                "block_number": tx_receipt.blockNumber,
                "gas_used": tx_receipt.gasUsed,
                "receipt": tx_receipt
            }
            
        except Exception as e:
            logger.error(f"Transaction failed: {e}")
            raise

    def register_workflow(self, workflow_id: int, trigger_source: str, trigger_type: int, 
                         trigger_target_value: int, commitment_hash: str) -> Dict[str, Any]:
        """
        Register a workflow on-chain using the WorkflowManager contract.
        
        Args:
            workflow_id: Database ID of the workflow
            trigger_source: Address of the Chainlink price feed
            trigger_type: 0 for GREATER_THAN, 1 for LESS_THAN
            trigger_target_value: Target price value (in wei/8 decimals for price feeds)
            commitment_hash: Keccak256 hash of the action payload
            
        Returns:
            Dictionary containing transaction details and upkeep_id
        """
        if not self.workflow_manager_contract:
            raise ConnectionError("WorkflowManager contract not initialized.")

        logger.info(f"Registering workflow {workflow_id} on-chain via contract: {self.workflow_manager_contract.address}")
        
        try:
            # Convert commitment_hash to bytes32 if it's a string
            if isinstance(commitment_hash, str):
                if commitment_hash.startswith('0x'):
                    commitment_hash = commitment_hash
                else:
                    commitment_hash = '0x' + commitment_hash
            
            # Prepare contract function call
            contract_function = self.workflow_manager_contract.functions.registerWorkflow(
                workflow_id,
                Web3.to_checksum_address(trigger_source),
                trigger_type,
                trigger_target_value,
                commitment_hash
            )
            
            # Send transaction with higher gas limit for complex registry calls
            tx_result = self._send_transaction(contract_function, gas_limit=1000000)
            
            # Parse events from transaction receipt
            receipt = tx_result["receipt"]
            
            # Get WorkflowRegistered event
            workflow_registered_events = self.workflow_manager_contract.events.WorkflowRegistered().process_receipt(receipt)
            
            if not workflow_registered_events:
                raise Exception("WorkflowRegistered event not found in transaction receipt")
            
            event_data = workflow_registered_events[0]['args']
            
            result = {
                "transaction_hash": tx_result["transaction_hash"],
                "workflow_id": event_data['workflowId'],
                "upkeep_id": event_data['upkeepId'],
                "commitment_hash": event_data['commitmentHash'],
                "block_number": tx_result["block_number"],
                "gas_used": tx_result["gas_used"]
            }
            
            logger.info(f"Workflow {workflow_id} successfully registered. Upkeep ID: {result['upkeep_id']}")
            return result
            
        except Exception as e:
            logger.error(f"Error registering workflow {workflow_id} on-chain: {e}")
            raise

    def register_workflow_direct_registrar(self, workflow_id: int, trigger_source: str, trigger_type: int, 
                                         trigger_target_value: int, commitment_hash: str) -> Dict[str, Any]:
        """
        WORKAROUND: Register workflow directly via Registrar v2.3 (bypasses WorkflowManager)
        This is needed because Chainlink Automation v2.3 moved registration to Registrar contract.
        INCLUDES PROPER LINK APPROVAL as per 2025 Chainlink docs.
        """
        try:
            logger.info("🚀 Registering workflow via DIRECT Registrar v2.3 (WORKAROUND)...")
            
            # STEP 1: Get LINK token contract and approve to Registrar
            fuji_link_address = "0x0b9d5D9136855f6FEc3c0993feE6E9CE8a297846"  # LINK on Fuji
            link_abi = [
                {"inputs":[{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}],"name":"approve","outputs":[{"name":"","type":"bool"}],"stateMutability":"nonpayable","type":"function"},
                {"inputs":[{"name":"account","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"}
            ]
            
            link_contract = self.w3.eth.contract(address=fuji_link_address, abi=link_abi)
            
            # Check LINK balance
            link_balance = link_contract.functions.balanceOf(self.account.address).call()
            required_amount = 5 * 10**18  # 5 LINK
            
            logger.info(f"Account LINK balance: {link_balance / 10**18:.2f} LINK")
            logger.info(f"Required amount: {required_amount / 10**18:.2f} LINK")
            
            if link_balance < required_amount:
                raise Exception(f"Insufficient LINK balance! Have {link_balance / 10**18:.2f}, need {required_amount / 10**18:.2f}")
            
            # APPROVE LINK to Registrar (CRITICAL STEP!)
            logger.info(f"💰 Approving {required_amount / 10**18} LINK to Registrar...")
            approve_function = link_contract.functions.approve(self.fuji_automation_registrar, required_amount)
            approve_tx = self._send_transaction(approve_function, gas_limit=100000)
            logger.info(f"✅ LINK approval successful: {approve_tx['transaction_hash']}")
            
            # STEP 2: Registrar v2.3 ABI (from official Chainlink docs 2025)
            registrar_abi = [
                {
                    "inputs": [
                        {"name": "requestParams", "type": "tuple", "components": [
                            {"name": "name", "type": "string"},
                            {"name": "encryptedEmail", "type": "bytes"},
                            {"name": "upkeepContract", "type": "address"},
                            {"name": "gasLimit", "type": "uint32"},
                            {"name": "adminAddress", "type": "address"},
                            {"name": "triggerType", "type": "uint8"},
                            {"name": "checkData", "type": "bytes"},
                            {"name": "triggerConfig", "type": "bytes"},
                            {"name": "offchainConfig", "type": "bytes"},
                            {"name": "amount", "type": "uint96"}
                        ]}
                    ],
                    "name": "registerUpkeep",
                    "outputs": [{"name": "", "type": "uint256"}],
                    "stateMutability": "nonpayable",
                    "type": "function"
                }
            ]
            
            # Create registrar contract instance
            registrar_contract = self.w3.eth.contract(
                address=self.fuji_automation_registrar,
                abi=registrar_abi
            )
            
            # STEP 3: Prepare upkeep parameters (as per 2025 Chainlink docs)
            request_params = (
                f"AVAX Price Workflow {workflow_id}",  # name
                b"",  # encryptedEmail (empty)
                self.fuji_proxy_address,  # upkeepContract (our WorkflowManager)
                500000,  # gasLimit
                self.account.address,  # adminAddress
                0,  # triggerType (0 = conditional)
                self.w3.keccak(text=f"workflow_{workflow_id}"),  # checkData
                b"",  # triggerConfig (empty for conditional)
                b"",  # offchainConfig (empty)
                required_amount  # amount (5 LINK in wei)
            )
            
            logger.info(f"Registrar params: name='{request_params[0]}', contract={request_params[2]}, gasLimit={request_params[3]}, amount={request_params[9] / 10**18} LINK")
            
            # STEP 4: Register upkeep
            contract_function = registrar_contract.functions.registerUpkeep(request_params)
            tx_result = self._send_transaction(contract_function, gas_limit=1200000)
            
            logger.info(f"🎯 Registrar transaction sent: {tx_result['transaction_hash']}")
            
            return {
                "transaction_hash": tx_result["transaction_hash"],
                "upkeep_id": "PENDING_REGISTRAR_EVENTS",  # Will be available in events or via registry query
                "success": True,
                "method": "DIRECT_REGISTRAR_v2.3_WITH_LINK_APPROVAL",
                "block_number": tx_result["block_number"],
                "gas_used": tx_result["gas_used"],
                "link_approval_tx": approve_tx["transaction_hash"]
            }
            
        except Exception as e:
            logger.error(f"Error in register_workflow_direct_registrar: {e}")
            return {"error": str(e), "success": False}

    def deregister_workflow(self, upkeep_id: str) -> Dict[str, Any]:
        """
        De-register a workflow by pausing its upkeep on-chain.
        This prevents orphaned upkeeps that continue to consume resources.
        
        Args:
            upkeep_id: The Chainlink Automation upkeep ID to pause
            
        Returns:
            Dictionary containing transaction details and status
        """
        if not self.workflow_manager_contract:
            raise ConnectionError("WorkflowManager contract not initialized.")

        logger.info(f"De-registering workflow upkeep {upkeep_id} on-chain via contract: {self.workflow_manager_contract.address}")
        
        try:
            # Convert upkeep_id to int if it's a string
            upkeep_id_int = int(upkeep_id)
            
            # Prepare contract function call
            contract_function = self.workflow_manager_contract.functions.pauseWorkflow(upkeep_id_int)
            
            # Send transaction
            tx_result = self._send_transaction(contract_function, gas_limit=100000)
            
            # Parse events from transaction receipt
            receipt = tx_result["receipt"]
            
            # Get WorkflowPaused event
            workflow_paused_events = self.workflow_manager_contract.events.WorkflowPaused().process_receipt(receipt)
            
            if workflow_paused_events:
                event_data = workflow_paused_events[0]['args']
                logger.info(f"Workflow upkeep {upkeep_id} paused successfully")
            
            result = {
                "transaction_hash": tx_result["transaction_hash"],
                "upkeep_id": upkeep_id,
                "status": "paused",
                "block_number": tx_result["block_number"],
                "gas_used": tx_result["gas_used"]
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Error de-registering workflow upkeep {upkeep_id}: {e}")
            # Return failure info for logging purposes
            return {
                "upkeep_id": upkeep_id,
                "status": "failed",
                "error": str(e)
            }

    def get_workflow_status(self, upkeep_id: str) -> Dict[str, Any]:
        """
        Get the current status of a workflow from the smart contract.
        
        Args:
            upkeep_id: The Chainlink Automation upkeep ID
            
        Returns:
            Dictionary containing workflow details
        """
        try:
            upkeep_id_int = int(upkeep_id)
            
            # Call contract view function
            workflow_data = self.workflow_manager_contract.functions.s_workflows(upkeep_id_int).call()
            
            return {
                "workflow_id": workflow_data[0],
                "is_active": workflow_data[1], 
                "trigger_source": workflow_data[2],
                "trigger_type": workflow_data[3],
                "trigger_target_value": workflow_data[4],
                "commitment_hash": workflow_data[5].hex()
            }
            
        except Exception as e:
            logger.error(f"Error getting workflow status for upkeep {upkeep_id}: {e}")
            raise

    def health_check(self) -> Dict[str, Any]:
        """
        Check the health of the blockchain connection and contract.
        
        Returns:
            Dictionary containing health status
        """
        try:
            # Check Web3 connection
            is_connected = self.w3.is_connected()
            
            # Get current block number
            current_block = self.w3.eth.block_number if is_connected else None
            
            # Check contract accessibility
            contract_accessible = False
            if is_connected and self.workflow_manager_contract:
                try:
                    # Try to call a view function
                    owner = self.workflow_manager_contract.functions.owner().call()
                    contract_accessible = True
                except:
                    contract_accessible = False
            
            return {
                "status": "healthy" if (is_connected and contract_accessible) else "unhealthy",
                "web3_connected": is_connected,
                "current_block": current_block,
                "contract_accessible": contract_accessible,
                "account_address": self.account.address,
                "contract_address": self.workflow_manager_contract.address if self.workflow_manager_contract else None,
                "chain_id": self.w3.eth.chain_id if is_connected else None
            }
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {
                "status": "unhealthy",
                "error": str(e)
            }

# Global instance
chain_service: Optional[ChainService] = None

def get_chain_service() -> ChainService:
    """
    Get or create the global chain service instance.
    """
    global chain_service
    if chain_service is None:
        chain_service = ChainService()
    return chain_service 