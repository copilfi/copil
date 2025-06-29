from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import Dict, Any, Optional

class ParsedAIResponse(BaseModel):
    """
    Standardized response structure from an AI service.
    """
    intent: str
    entities: Dict[str, Any]
    confidence: float
    original_text: str
    response_text: str
    raw_response: Optional[Dict[str, Any]] = None

class AIServiceInterface(ABC):
    """
    Abstract base class for AI services.
    Defines the contract that all AI service implementations must follow.
    """

    @abstractmethod
    async def generate_response(self, user_input: str) -> ParsedAIResponse:
        """
        Processes user input to identify intent and entities.

        Args:
            user_input: The natural language text from the user.

        Returns:
            A ParsedAIResponse object containing the structured data.
        
        Raises:
            Exception: If the AI service fails to process the request.
        """
        pass 