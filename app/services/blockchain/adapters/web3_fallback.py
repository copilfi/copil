"""
Direct Web3 Fallback Adapter

This adapter provides basic blockchain functionality when OneBalance is unavailable.
It offers minimal but critical operations for emergency cases.
"""

import logging
from typing import Dict, Any, Optional, List
from web3 import Web3
from eth_account import Account
from eth_account.signers.local import LocalAccount
import json
import aiohttp
import asyncio
from datetime import datetime, timezone

from app.core.config import settings
from app.services.blockchain.base import (
    BlockchainServiceInterface, 
    SwapQuote, 
    TransactionResult, 
    PortfolioBalance,
    BridgeQuote,
    StakingQuote,
    LendingQuote,
    OnchainData,
    TransactionStatus,
    BlockchainServiceException,
    NetworkException,
    UnsupportedAssetException
)
from app.services.security.dev_signing_service import dev_signing_service

logger = logging.getLogger(settings.APP_NAME)

# --- MVP CHANGE: Load Contract ABI ---
# In a real app, this might be loaded from a file or a central config
WORKFLOW_MANAGER_ABI = json.loads('''
[
    {
        "inputs": [
            { "internalType": "uint256", "name": "workflowId", "type": "uint256" },
            { "internalType": "address", "name": "triggerSource", "type": "address" },
            { "internalType": "enum WorkflowManager.TriggerType", "name": "triggerType", "type": "uint8" },
            { "internalType": "int256", "name": "triggerTargetValue", "type": "int256" },
            { "internalType": "bytes32", "name": "commitmentHash", "type": "bytes32" }
        ],
        "name": "registerWorkflow",
        "outputs": [
            { "internalType": "uint256", "name": "upkeepId", "type": "uint256" }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
    }
]
''')


class DirectWeb3Adapter(BlockchainServiceInterface):
    """
    Fallback blockchain adapter using direct Web3 connections.
    Provides minimal functionality for emergency cases when OneBalance is down.
    """
    
    def __init__(self):
        self.provider_name = "DirectWeb3Fallback"
        self._web3_connections: Dict[str, Web3] = {}
        self._initialize_connections()
        self.signer: Optional[LocalAccount] = None

        # --- MVP CHANGE: Initialize signer for development ---
        if settings.ENVIRONMENT == "development" and dev_signing_service:
            self.signer = dev_signing_service.get_signer()
            logger.info(f"DirectWeb3Adapter initialized with development signer: {self.signer.address}")
        else:
            logger.warning("DirectWeb3Adapter running without a signer. On-chain transactions will fail.")
        
    def _initialize_connections(self):
        """Initialize Web3 connections for supported chains"""
        # --- MVP CHANGE: Ensure Fuji is configured for workflows ---
        rpc_configs = {
            "ethereum": settings.ETHEREUM_RPC_URL,
            "avalanche": settings.AVALANCHE_RPC_URL, 
            "base": settings.BASE_RPC_URL,
            "fuji": settings.AVALANCHE_FUJI_RPC_URL
        }
        
        for chain, rpc_url in rpc_configs.items():
            if rpc_url:
                try:
                    self._web3_connections[chain] = Web3(Web3.HTTPProvider(rpc_url))
                    logger.info(f"Initialized Web3 connection for {chain}")
                except Exception as e:
                    logger.error(f"Failed to initialize Web3 for {chain}: {e}")
    
    def _get_web3(self, chain: str) -> Web3:
        """Get Web3 connection for chain"""
        if chain not in self._web3_connections:
            raise UnsupportedAssetException(f"Chain {chain} not supported in fallback adapter")
        return self._web3_connections[chain]
    
    async def get_swap_quote(
        self,
        from_asset: str,
        to_asset: str,
        amount: str,
        from_chain: str,
        to_chain: str,
        sca_address: str,
        slippage: float = 0.5
    ) -> SwapQuote:
        """
        FALLBACK LIMITATION: Direct swaps not implemented.
        Returns a mock quote to prevent total system failure.
        """
        logger.warning("Swap functionality limited in fallback mode")
        
        # Return a basic quote that indicates fallback mode
        return SwapQuote(
            quote_id=f"fallback_{int(datetime.now().timestamp())}",
            from_asset=from_asset,
            to_asset=to_asset,
            from_amount=amount,
            to_amount="0",  # Cannot calculate without DEX access
            from_chain=from_chain,
            to_chain=to_chain,
            route=[{"note": "Fallback mode - manual execution required"}],
            estimated_gas="0",
            gas_price_gwei="0",
            slippage=slippage,
            expires_at=int(datetime.now().timestamp()) + 300,
            provider=self.provider_name,
            price_impact=None,
            minimum_received=None
        )
    
    async def execute_swap(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """FALLBACK LIMITATION: Cannot execute swaps directly"""
        raise UnsupportedAssetException("Swap execution not available in fallback mode")
    
    async def get_portfolio(
        self,
        address: str,
        chains: Optional[List[str]] = None
    ) -> PortfolioBalance:
        """Get basic portfolio info using direct RPC calls"""
        try:
            chains_to_check = chains or ["ethereum", "avalanche", "base"]
            total_assets = []
            total_value = 0.0
            
            for chain in chains_to_check:
                if chain in self._web3_connections:
                    web3 = self._get_web3(chain)
                    
                    # Get native token balance
                    balance_wei = web3.eth.get_balance(address)
                    balance_eth = web3.from_wei(balance_wei, 'ether')
                    
                    asset_info = {
                        "symbol": self._get_native_symbol(chain),
                        "balance": str(balance_eth),
                        "value_usd": "0",  # Cannot get price without external API
                        "chain": chain
                    }
                    total_assets.append(asset_info)
            
            return PortfolioBalance(
                address=address,
                chain="multi-chain",
                assets=total_assets,
                total_value_usd="0",  # Limited calculation in fallback
                provider=self.provider_name,
                last_updated=int(datetime.now().timestamp())
            )
            
        except Exception as e:
            logger.error(f"Portfolio fetch failed in fallback mode: {e}")
            raise NetworkException(f"Portfolio fetch failed: {e}", provider=self.provider_name)
    
    def _get_native_symbol(self, chain: str) -> str:
        """Get native token symbol for chain"""
        symbols = {
            "ethereum": "ETH",
            "avalanche": "AVAX", 
            "base": "ETH"
        }
        return symbols.get(chain, "UNKNOWN")
    
    async def get_transaction_status(
        self,
        tx_hash: str,
        chain: str
    ) -> TransactionResult:
        """Get transaction status using Web3"""
        try:
            web3 = self._get_web3(chain)
            
            # Get transaction receipt
            receipt = web3.eth.get_transaction_receipt(tx_hash)
            
            status = TransactionStatus.CONFIRMED if receipt.status == 1 else TransactionStatus.FAILED
            
            return TransactionResult(
                transaction_hash=tx_hash,
                status=status,
                block_number=receipt.blockNumber,
                gas_used=receipt.gasUsed,
                gas_price_gwei=str(web3.from_wei(receipt.effectiveGasPrice, 'gwei')),
                provider=self.provider_name
            )
            
        except Exception as e:
            logger.error(f"Transaction status check failed: {e}")
            return TransactionResult(
                transaction_hash=tx_hash,
                status=TransactionStatus.FAILED,
                error_message=str(e),
                provider=self.provider_name
            )
    
    async def get_bridge_quote(
        self,
        asset: str,
        amount: str,
        from_chain: str,
        to_chain: str,
        sca_address: str
    ) -> BridgeQuote:
        """FALLBACK LIMITATION: Bridge quotes not available"""
        raise UnsupportedAssetException("Bridge functionality not available in fallback mode")
    
    async def execute_bridge(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """FALLBACK LIMITATION: Bridge execution not available"""
        raise UnsupportedAssetException("Bridge execution not available in fallback mode")
    
    async def get_supported_assets(
        self,
        chain: str
    ) -> List[Dict[str, Any]]:
        """Return basic native token info"""
        native_symbol = self._get_native_symbol(chain)
        
        return [{
            "symbol": native_symbol,
            "name": f"{chain.title()} Native Token",
            "address": "0x0000000000000000000000000000000000000000",
            "decimals": 18,
            "chain": chain,
            "note": "Fallback mode - limited asset support"
        }]
    
    async def estimate_gas(
        self,
        operation: str,
        params: Dict[str, Any],
        chain: str
    ) -> Dict[str, Any]:
        """Basic gas estimation"""
        try:
            web3 = self._get_web3(chain)
            gas_price = web3.eth.gas_price
            
            # Basic gas estimates for common operations
            gas_estimates = {
                "transfer": 21000,
                "swap": 150000,
                "bridge": 200000,
                "approve": 45000
            }
            
            estimated_gas = gas_estimates.get(operation, 100000)
            
            return {
                "gas_limit": estimated_gas,
                "gas_price_wei": gas_price,
                "gas_price_gwei": web3.from_wei(gas_price, 'gwei'),
                "estimated_cost_wei": estimated_gas * gas_price,
                "provider": self.provider_name
            }
            
        except Exception as e:
            logger.error(f"Gas estimation failed: {e}")
            raise NetworkException(f"Gas estimation failed: {e}", provider=self.provider_name)
    
    async def health_check(self) -> Dict[str, Any]:
        """Check fallback service health"""
        healthy_chains = []
        unhealthy_chains = []
        
        for chain, web3 in self._web3_connections.items():
            try:
                latest_block = web3.eth.block_number
                healthy_chains.append({
                    "chain": chain,
                    "latest_block": latest_block,
                    "status": "healthy"
                })
            except Exception as e:
                unhealthy_chains.append({
                    "chain": chain,
                    "error": str(e),
                    "status": "unhealthy"
                })
        
        overall_status = "healthy" if len(healthy_chains) > 0 else "unhealthy"
        
        return {
            "status": overall_status,
            "provider": self.provider_name,
            "mode": "fallback",
            "healthy_chains": healthy_chains,
            "unhealthy_chains": unhealthy_chains,
            "limitations": [
                "No DEX integration - swaps unavailable",
                "No bridge functionality", 
                "Limited asset support",
                "No price data",
                "Emergency mode only"
            ],
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    
    async def predict_sca_address(self, owner_address: str) -> str:
        """FALLBACK LIMITATION: SCA prediction not available"""
        raise UnsupportedAssetException("SCA prediction not available in fallback mode")
    
    async def get_staking_quote(
        self,
        asset: str,
        amount: str,
        staking_pool: str,
        from_chain: str,
        sca_address: str
    ) -> StakingQuote:
        """FALLBACK LIMITATION: Staking not available"""
        raise UnsupportedAssetException("Staking functionality not available in fallback mode")
    
    async def execute_staking(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """FALLBACK LIMITATION: Staking execution not available"""
        raise UnsupportedAssetException("Staking execution not available in fallback mode")
    
    async def get_lending_quote(
        self,
        asset: str,
        amount: str,
        lending_pool: str,
        from_chain: str,
        sca_address: str
    ) -> LendingQuote:
        """FALLBACK LIMITATION: Lending not available"""
        raise UnsupportedAssetException("Lending functionality not available in fallback mode")
    
    async def execute_supply(
        self,
        quote_id: str,
        user_signature: str,
        sca_address: str
    ) -> TransactionResult:
        """FALLBACK LIMITATION: Supply execution not available"""
        raise UnsupportedAssetException("Supply execution not available in fallback mode")
    
    async def get_onchain_data(self, source: str, chain: str) -> OnchainData:
        """Get basic onchain data like block number"""
        try:
            web3 = self._get_web3(chain)
            
            if source == "latest_block":
                block_number = web3.eth.block_number
                return OnchainData(
                    source=source,
                    chain=chain,
                    value=block_number,
                    provider=self.provider_name,
                    retrieved_at=int(datetime.now().timestamp())
                )
            else:
                raise UnsupportedAssetException(f"Onchain data source '{source}' not supported in fallback mode")
                
        except Exception as e:
            logger.error(f"Onchain data fetch failed: {e}")
            raise NetworkException(f"Onchain data fetch failed: {e}", provider=self.provider_name)
    
    # --- MVP CHANGE: Implement registerWorkflow ---
    async def register_workflow(
        self,
        workflow_id: int,
        trigger_source: str,
        trigger_type: int,
        trigger_target_value: int,
        commitment_hash: bytes
    ) -> TransactionResult:
        
        if not self.signer:
            raise BlockchainServiceException("No signer available, cannot register workflow on-chain.", provider=self.provider_name)
            
        logger.info(f"Registering workflow {workflow_id} on-chain via DirectWeb3Adapter")
        
        # --- FUJI REVERT: Pointing back to Fuji Testnet ---
        chain = "fuji" 
        web3 = self._get_web3(chain)
        contract_address = settings.WORKFLOW_MANAGER_CONTRACT_ADDRESS
        
        if not contract_address:
            raise BlockchainServiceException("Workflow Manager contract address is not configured.", provider=self.provider_name)

        try:
            contract = web3.eth.contract(address=Web3.to_checksum_address(contract_address), abi=WORKFLOW_MANAGER_ABI)
            
            # --- GAS FIX: Increase gas price to ensure transaction is picked up ---
            current_gas_price = web3.eth.gas_price
            priority_gas_price = int(current_gas_price * 1.2) # Increase by 20%
            logger.info(f"Using priority gas price: {priority_gas_price} wei (20% increase over {current_gas_price} wei)")

            # Build the transaction
            tx_data = contract.functions.registerWorkflow(
                workflow_id,
                Web3.to_checksum_address(trigger_source),
                trigger_type,
                trigger_target_value,
                commitment_hash
            ).build_transaction({
                'from': self.signer.address,
                'nonce': web3.eth.get_transaction_count(self.signer.address),
                'gas': 2_000_000, 
                'gasPrice': priority_gas_price # Use the increased gas price
            })
            
            # Sign the transaction
            signed_tx = self.signer.sign_transaction(tx_data)
            
            # Send the transaction
            tx_hash = web3.eth.send_raw_transaction(signed_tx.rawTransaction)
            
            # --- TIMEOUT FIX: Wait for receipt with a specific timeout ---
            logger.info(f"Transaction sent with hash: {tx_hash.hex()}. Waiting for receipt with a 60s timeout...")
            
            # Wait for the transaction receipt
            try:
                receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=60) # 60-second timeout
            except Exception as e: # Catches web3.exceptions.TimeExhausted
                logger.error(f"Transaction receipt timed out for hash {tx_hash.hex()}: {e}")
                raise BlockchainServiceException(f"Transaction with hash {tx_hash.hex()} timed out after 60 seconds.", provider=self.provider_name) from e

            
            upkeep_id = None # You would need to parse logs to get this, for MVP we can skip
            
            return TransactionResult(
                transaction_hash=tx_hash.hex(),
                status=TransactionStatus.CONFIRMED if receipt.status == 1 else TransactionStatus.FAILED,
                block_number=receipt.blockNumber,
                gas_used=receipt.gasUsed,
                upkeep_id=upkeep_id,
                provider=self.provider_name
            )

        except Exception as e:
            logger.error(f"Failed to register workflow on-chain: {e}")
            raise BlockchainServiceException(f"On-chain registration failed: {e}", provider=self.provider_name) from e
            
    # --- END MVP CHANGE --- 