from fastapi import APIRouter, Depends, HTTPException

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService
from app.core.security import get_current_active_user
from app.models.user import User

router = APIRouter()

# Dependency to get an instance of our chat service
def get_chat_service():
    return ChatService()

@router.post(
    "/",
    response_model=ChatResponse,
    summary="Send a message to the AI Chat Assistant"
)
async def post_chat_message(
    chat_request: ChatRequest,
    user: User = Depends(get_current_active_user),
    chat_service: ChatService = Depends(get_chat_service)
):
    """
    Handles a user's chat message.

    This endpoint takes a message from the user, passes it to the ChatService,
    which then uses the AIManager to get a structured response from the
    configured AI providers (with fallback support).
    
    The response includes the AI's natural language reply, the identified intent,
    and any extracted entities.
    """
    # The user object is available if you need to pass user-specific context
    # to the chat service in the future.
    return await chat_service.handle_chat(chat_request) 