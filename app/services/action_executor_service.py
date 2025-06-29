# backend/app/services/action_executor_service.py
import logging
from sqlalchemy.orm import Session
from sqlalchemy.future import select
from datetime import datetime
import re
import operator as op

from app.models.workflow import Workflow, WorkflowStatus
from app.models.execution import WorkflowExecution, ExecutionStatus
from app.services.blockchain.manager import blockchain_manager
from app.services.blockchain.base import BlockchainServiceException, SwapQuote, TransactionResult, BridgeQuote, StakingQuote, LendingQuote, OnchainData
from app.services.security.signing_service import signing_service, SigningException

logger = logging.getLogger(__name__)

class ActionExecutorService:
    """
    Executes the action part of a workflow based on a trigger event from the blockchain.
    """
    def __init__(self, db: Session):
        self.db = db

    async def execute_for_workflow(self, workflow_id: int):
        """
        Executes a workflow by traversing its nodes as a Directed Acyclic Graph (DAG).
        """
        async with self.db.begin():
            result = await self.db.execute(
                select(Workflow).options(selectinload(Workflow.user)).where(Workflow.id == workflow_id)
            )
            workflow = result.scalar_one_or_none()

        if not workflow:
            logger.error(f"Workflow with ID {workflow_id} not found for execution.")
            return

        logger.info(f"Beginning execution for workflow {workflow.id}, owned by user {workflow.user_id}.")

        execution = WorkflowExecution(workflow_id=workflow.id)
        start_node_id = workflow.start_node_id
        if not start_node_id:
            logger.warning(f"Workflow {workflow.id} has no start node. Cannot execute.")
            execution.fail_execution(error={"message": "Workflow has no start node."})
            self.db.add(execution)
            await self.db.commit()
            return

        execution.start_execution(start_node_id=start_node_id)
        self.db.add(execution)
        await self.db.commit()
        await self.db.refresh(execution)
        logger.info(f"Created execution record {execution.id} for workflow {workflow.id}. Starting at node '{start_node_id}'.")

        nodes_map = {node['id']: node for node in workflow.nodes}
        edges_map = {}
        for edge in workflow.edges:
            edges_map.setdefault(edge['source'], []).append(edge)

        try:
            while execution.current_node_id:
                current_node_id = execution.current_node_id
                action_node = nodes_map.get(current_node_id)
                
                if not action_node:
                    raise ValueError(f"Node with ID '{current_node_id}' not found in workflow definition.")

                action_type = action_node.get('type')
                action_config = action_node.get('config', {})
                
                logger.info(f"Executing node '{current_node_id}' ('{action_type}') for execution {execution.id}.")

                resolved_config = self._resolve_inputs(action_config, execution.execution_data)
                
                next_node_id = None
                node_output = {}

                if action_type == 'condition':
                    condition_met = await self._handle_condition(resolved_config, blockchain_manager)
                    node_output = {"result": condition_met, "message": f"Condition evaluated to {condition_met}"}
                    
                    label_to_find = "on_true" if condition_met else "on_false"
                    outgoing_edges = edges_map.get(current_node_id, [])
                    next_edge = next((edge for edge in outgoing_edges if edge.get('label') == label_to_find), None)
                    
                    if next_edge:
                        next_node_id = next_edge.get('target')
                        logger.info(f"Condition is {condition_met}, following edge with label '{label_to_find}' to node '{next_node_id}'.")
                    else:
                        logger.info(f"Condition is {condition_met}, but no edge found for label '{label_to_find}'. Ending workflow.")

                else:  # Handles all transactional actions
                    sca_address = workflow.user.sca_address
                    quote, message_to_sign, target_contract = await self._get_quote_for_action(
                        action_type, resolved_config, sca_address, blockchain_manager
                    )
                    
                    tx_result = await self._sign_and_execute(
                        db=self.db, user_id=workflow.user_id, sca_address=sca_address,
                        action_type=action_type, quote=quote, message_to_sign=message_to_sign,
                        target_contract=target_contract, signing_service=signing_service,
                        blockchain_manager=blockchain_manager
                    )
                    
                    # Store transaction hash in execution record
                    execution.transaction_hash = tx_result.transaction_hash
                    
                    node_output = {"tx_hash": tx_result.transaction_hash, "status": tx_result.status.value, "quote": quote.dict()}
                    
                    outgoing_edges = edges_map.get(current_node_id, [])
                    next_edge = next((edge for edge in outgoing_edges if edge.get('label', 'default') == 'default'), None)
                    if next_edge:
                        next_node_id = next_edge.get('target')
                        logger.info(f"Action completed, following default edge to node '{next_node_id}'.")
                    else:
                        logger.info("Action completed. No further nodes to execute. Ending workflow.")

                execution.execution_data.setdefault('nodes', {})[current_node_id] = {"output": node_output}
                execution.advance_to_node(next_node_id)
                await self.db.commit()
                await self.db.refresh(execution)

            final_result = {"message": "Workflow completed successfully."}
            # Pass action results including transaction hash to complete_execution
            action_results = execution.execution_data.get('nodes', {})
            execution.complete_execution(action_results, execution.transaction_hash)
            logger.info(f"Execution {execution.id} completed successfully.")

        except Exception as e:
            logger.error(f"Execution {execution.id} failed at node {execution.current_node_id}: {e}", exc_info=True)
            execution.fail_execution(error={"message": str(e)})
        
        finally:
            await self.db.commit()

    async def _get_quote_for_action(self, action_type, config, sca_address, blockchain_manager):
        """Helper to get a quote and identify signing details for any action type."""
        quote, message_to_sign, target_contract = None, None, None
        
        if action_type == 'swap':
            quote = await self._handle_swap_quote(config, sca_address, blockchain_manager)
            target_contract = quote.route[0]['toTokenAddress'] if quote.route else config.get('from_asset')
            message_to_sign = quote.quote_id
        elif action_type == 'bridge':
            quote = await self._handle_bridge_quote(config, sca_address, blockchain_manager)
            target_contract = config.get('asset')
            message_to_sign = quote.quote_id
        elif action_type == 'stake':
            quote = await self._handle_staking_quote(config, sca_address, blockchain_manager)
            target_contract = quote.staking_pool_address
            message_to_sign = quote.quote_id
        elif action_type == 'supply_asset':
            quote = await self._handle_lending_quote(config, sca_address, blockchain_manager)
            target_contract = quote.lending_pool_address
            message_to_sign = quote.quote_id
        else:
            raise ValueError(f"Unsupported action type for quoting: '{action_type}'")
            
        return quote, message_to_sign, target_contract
        
    def _resolve_inputs(self, config: dict, execution_data: dict) -> dict:
        """Resolves placeholder values in the config with actual data from previous nodes."""
        resolved_config = {}
        # Regex to find placeholders like {{nodes['node-0'].output.quote.to_amount}}
        placeholder_pattern = re.compile(r"\{\{([\w.\[\]'\" ]+)\}\}")

        for key, value in config.items():
            if isinstance(value, str):
                match = placeholder_pattern.match(value)
                if match:
                    path = match.group(1).strip()
                    try:
                        # Path resolver for format like: nodes['node-0'].output.quote.to_amount
                        resolved_value = execution_data
                        for part in path.replace("'", "").replace('"', "").replace(']', '').split('['):
                             for key_part in part.split('.'):
                                if key_part:
                                    resolved_value = resolved_value.get(key_part)
                        
                        if resolved_value is None:
                            raise ValueError(f"Could not resolve placeholder '{value}'. Path '{path}' not found in execution data: {execution_data}")
                        
                        resolved_config[key] = resolved_value
                        logger.info(f"Resolved input for '{key}': '{value}' -> '{resolved_value}'")
                    except (KeyError, IndexError, TypeError) as e:
                        raise ValueError(f"Error resolving placeholder '{value}': {e}")
                else:
                    resolved_config[key] = value
            else:
                resolved_config[key] = value
        
        return resolved_config

    async def _handle_swap_quote(self, config: dict, sca_address: str, blockchain_manager) -> SwapQuote:
        from_asset = config.get('from_asset')
        to_asset = config.get('to_asset')
        amount = str(config.get('amount'))
        from_chain = config.get('from_chain')
        to_chain = config.get('to_chain')
        if not all([from_asset, to_asset, amount, from_chain, to_chain]):
            raise ValueError("Swap action config is missing required fields.")
        return await blockchain_manager.get_swap_quote(
            from_asset=from_asset, to_asset=to_asset, amount=amount,
            from_chain=from_chain, to_chain=to_chain, sca_address=sca_address
        )

    async def _handle_bridge_quote(self, config: dict, sca_address: str, blockchain_manager) -> BridgeQuote:
        asset = config.get('asset')
        amount = str(config.get('amount'))
        from_chain = config.get('from_chain')
        to_chain = config.get('to_chain')
        if not all([asset, amount, from_chain, to_chain]):
            raise ValueError("Bridge action config is missing required fields.")
        return await blockchain_manager.get_bridge_quote(
            asset=asset, amount=amount, from_chain=from_chain,
            to_chain=to_chain, sca_address=sca_address
        )

    async def _handle_staking_quote(self, config: dict, sca_address: str, blockchain_manager) -> StakingQuote:
        asset = config.get('asset')
        amount = str(config.get('amount'))
        from_chain = config.get('from_chain')
        staking_pool = config.get('staking_pool')
        if not all([asset, amount, from_chain, staking_pool]):
            raise ValueError("Staking action config is missing required fields.")
        return await blockchain_manager.get_staking_quote(
            asset=asset, amount=amount, from_chain=from_chain,
            staking_pool=staking_pool, sca_address=sca_address
        )

    async def _handle_lending_quote(self, config: dict, sca_address: str, blockchain_manager) -> LendingQuote:
        asset = config.get('asset')
        amount = str(config.get('amount'))
        from_chain = config.get('from_chain')
        lending_pool = config.get('lending_pool')
        if not all([asset, amount, from_chain, lending_pool]):
            raise ValueError("Lending supply action config is missing required fields.")
        return await blockchain_manager.get_lending_quote(
            asset=asset, amount=amount, from_chain=from_chain,
            lending_pool=lending_pool, sca_address=sca_address
        )

    async def _handle_condition(self, config: dict, blockchain_manager) -> bool:
        """Handles a condition node, returns True if condition is met, False otherwise."""
        source = config.get('source') # e.g., "price_feed:MATIC-USD"
        operator_str = config.get('operator') # e.g., ">", "<", "=="
        target_value = config.get('value')
        chain = config.get('chain')

        if not all([source, operator_str, chain]) or target_value is None:
            raise ValueError("Condition node config is missing required fields (source, operator, value, chain).")

        # Get the real-time on-chain data
        data: OnchainData = await blockchain_manager.get_onchain_data(source, chain)
        actual_value = data.value
        
        # Define allowed operators
        ops = {
            '>': op.gt,
            '<': op.lt,
            '>=': op.ge,
            '<=': op.le,
            '==': op.eq,
            '!=': op.ne
        }
        
        operator_func = ops.get(operator_str)
        if not operator_func:
            raise ValueError(f"Unsupported operator '{operator_str}' in condition node.")

        # Ensure types are comparable (e.g., both are numbers)
        try:
            comparison_result = operator_func(float(actual_value), float(target_value))
        except (ValueError, TypeError):
            # Fallback to string comparison if casting fails
            comparison_result = operator_func(str(actual_value), str(target_value))

        logger.info(f"Condition check: {actual_value} {operator_str} {target_value} -> {comparison_result}")
        return comparison_result

    async def _sign_and_execute(
        self, db, user_id: int, sca_address: str, action_type: str, quote,
        message_to_sign: str, target_contract: str,
        signing_service, blockchain_manager
    ) -> TransactionResult:
        
        logger.info(f"Received quote {quote.quote_id}. Finding a valid grant to sign...")
        
        if hasattr(quote, 'from_amount'):
            amount_to_check = quote.from_amount
        elif hasattr(quote, 'amount'):
            amount_to_check = quote.amount
        else:
            raise ValueError("Quote object does not have a recognizable amount field.")
        
        grant = await signing_service.find_valid_grant_for_action(
            db=db, user_id=user_id,
            target_contract=target_contract, value=int(amount_to_check)
        )
        if not grant:
            raise SigningException(f"No valid session key grant found for this action for user {user_id}")

        signer = await signing_service.get_signer_for_grant(grant)
        signed_message = signer.sign_message(text=message_to_sign)
        user_signature = signed_message.signature.hex()
        
        logger.info(f"Action signed using grant {grant.id} and session key {grant.public_address}.")

        if action_type == 'swap':
            tx_result = await blockchain_manager.execute_swap(
                quote_id=quote.quote_id, user_signature=user_signature, sca_address=sca_address
            )
        elif action_type == 'bridge':
            tx_result = await blockchain_manager.execute_bridge(
                quote_id=quote.quote_id, user_signature=user_signature, sca_address=sca_address
            )
        elif action_type == 'stake':
            tx_result = await blockchain_manager.execute_staking(
                quote_id=quote.quote_id, user_signature=user_signature, sca_address=sca_address
            )
        elif action_type == 'supply_asset':
            tx_result = await blockchain_manager.execute_supply(
                quote_id=quote.quote_id, user_signature=user_signature, sca_address=sca_address
            )
        else:
            # This case should have been caught earlier, but as a safeguard:
            raise ValueError(f"Cannot execute unknown action type: {action_type}")

        logger.info(f"Action executed. Tx hash: {tx_result.transaction_hash}, Status: {tx_result.status}")
        return tx_result 