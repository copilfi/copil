import logging
from typing import Optional

from app.core.config import settings
from app.services.ai.base import AIServiceInterface, ParsedAIResponse
from app.services.ai.bedrock_service import BedrockAIService
from app.services.ai.openai_service import OpenAIAIService

logger = logging.getLogger(__name__)

class AIManager:
    """
    Manages AI services, providing a fallback mechanism.
    It tries the primary provider first, and if it fails, it falls back to the secondary provider.
    """

    def __init__(self):
        self.primary_service: Optional[AIServiceInterface] = None
        self.fallback_service: Optional[AIServiceInterface] = None
        
        primary_provider = settings.PRIMARY_AI_PROVIDER.lower()
        
        # Instantiate services based on configuration
        try:
            if primary_provider == "bedrock":
                self.primary_service = BedrockAIService()
                self.fallback_service = OpenAIAIService()
                logger.info("Primary AI Provider: Bedrock, Fallback: OpenAI")
            elif primary_provider == "openai":
                self.primary_service = OpenAIAIService()
                self.fallback_service = BedrockAIService()
                logger.info("Primary AI Provider: OpenAI, Fallback: Bedrock")
            else:
                raise ValueError(f"Unsupported primary AI provider: {primary_provider}")
        except ValueError as e:
            logger.error(f"AI Service initialization error: {e}")
            # Attempt to configure OpenAI as a standalone primary if primary fails
            try:
                self.primary_service = OpenAIAIService()
                logger.warning("Could not initialize primary provider, falling back to OpenAI as primary.")
            except ValueError:
                 logger.error("Failed to initialize any AI service.")


    async def generate_response(self, user_input: str) -> ParsedAIResponse:
        """
        Generates a response using the primary AI service, with a fallback to the secondary service.
        """
        if not self.primary_service:
            raise RuntimeError("No AI service is available.")

        try:
            logger.debug("Attempting to use primary AI service...")
            return await self.primary_service.generate_response(user_input)
        except Exception as e:
            logger.warning(f"Primary AI service failed: {e}. Attempting fallback...")
            
            if not self.fallback_service:
                logger.error("Fallback AI service is not configured. Cannot proceed.")
                raise RuntimeError("Primary AI service failed and no fallback is available.") from e

            try:
                logger.debug("Attempting to use fallback AI service...")
                return await self.fallback_service.generate_response(user_input)
            except Exception as fallback_e:
                logger.critical(f"Fallback AI service also failed: {fallback_e}")
                raise RuntimeError("Both primary and fallback AI services failed.") from fallback_e

# Create a single instance of the manager to be used across the application
ai_manager = AIManager() 