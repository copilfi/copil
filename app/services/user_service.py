from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import logging

from app.models.user import User
from app.core.database import Base
from app.core.database import get_db
from app.services.blockchain.manager import blockchain_manager

logger = logging.getLogger(__name__)

class UserService:
    """
    Service for handling user-related database operations.
    """
    async def get_by_privy_id(self, db: AsyncSession, *, privy_id: str) -> Optional[User]:
        """
        Retrieves a user by their Privy DID (Decentralized Identifier).
        """
        result = await db.execute(select(User).filter(User.privy_id == privy_id))
        return result.scalars().first()

    async def create_from_privy(self, db: AsyncSession, *, privy_id: str, linked_accounts: List[Dict[str, Any]]) -> User:
        """
        Creates a new user from Privy claims, predicts their SCA, and saves to the DB.
        """
        wallet_address = None
        for account in linked_accounts:
            if account.get("type") == "wallet":
                wallet_address = account.get("address")
                break
        
        new_user = User(
            privy_id=privy_id,
            wallet_address=wallet_address,
            tier="free",
            is_active=True
        )
        
        # Predict the Smart Contract Account (SCA) address
        if wallet_address:
            try:
                predicted_sca = await blockchain_manager.predict_sca_address(owner_address=wallet_address)
                new_user.sca_address = predicted_sca
                logger.info(f"Predicted SCA address {predicted_sca} for user {privy_id}.")
            except Exception as e:
                # Log the error but don't block user creation
                logger.error(f"Could not predict SCA address for user {privy_id}: {e}")

        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        return new_user

    async def get_or_create_from_privy(self, db: AsyncSession, *, privy_claims: Dict[str, Any]) -> User:
        """
        Gets a user by their Privy ID, or creates a new one if they don't exist.
        Also ensures that any user logging in is marked as active.
        """
        privy_id = privy_claims.get("sub")
        if not privy_id:
            raise ValueError("Privy claims must contain a 'sub' (subject) field, which is the Privy DID.")
            
        user = await self.get_by_privy_id(db=db, privy_id=privy_id)
        
        if not user:
            linked_accounts = privy_claims.get("https://privy.io/claims", {}).get("linked_accounts", [])
            user = await self.create_from_privy(db=db, privy_id=privy_id, linked_accounts=linked_accounts)
        elif not user.is_active:
            logger.info(f"User {user.id} was inactive. Activating now.")
            user.is_active = True
            db.add(user)
            await db.commit()
            await db.refresh(user)
            
        return user

# A singleton instance of the service to be used across the application
user_service = UserService() 