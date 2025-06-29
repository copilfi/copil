from fastapi import HTTPException
import logging

from app.services.ai.manager import ai_manager
from app.services.ai.base import ParsedAIResponse
from app.schemas.chat import ChatRequest, ChatResponse

logger = logging.getLogger(__name__)

class ChatService:
    """
    Service to handle chat interactions, using the AIManager to get responses.
    """

    async def handle_chat(self, chat_request: ChatRequest) -> ChatResponse:
        """
        Takes a user's message, gets a structured response from the AI,
        and prepares a response for the user.
        """
        user_message = chat_request.message
        if not user_message:
            raise HTTPException(status_code=400, detail="Message cannot be empty.")

        try:
            # Use the AI manager to get a response.
            # The manager handles the primary/fallback logic internally.
            ai_response: ParsedAIResponse = await ai_manager.generate_response(user_message)
            
            logger.info(f"AI processed intent '{ai_response.intent}' with confidence {ai_response.confidence}")

            # Here you could add logic to dispatch actions based on intent.
            # For now, we just return the AI's response.
            # Example:
            # if ai_response.intent == 'swap':
            #     await swap_service.execute(ai_response.entities)
            
            return ChatResponse(
                response=ai_response.response_text,
                intent=ai_response.intent,
                entities=ai_response.entities,
                confidence=ai_response.confidence
            )

        except RuntimeError as e:
            logger.critical(f"Both AI services failed. Error: {e}")
            raise HTTPException(
                status_code=503, 
                detail="Our AI services are temporarily unavailable. Please try again later."
            )
        except Exception as e:
            logger.error(f"An unexpected error occurred in ChatService: {e}")
            raise HTTPException(
                status_code=500,
                detail="An internal error occurred."
            )

# A singleton instance of the service to be used across the application
chat_service = ChatService() 