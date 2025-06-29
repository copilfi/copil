import openai
from typing import Dict, Any
import json
import logging

from app.core.config import settings
from app.services.ai.base import AIServiceInterface, ParsedAIResponse
from app.services.ai.prompts import SYSTEM_PROMPT

# Configure logging
logger = logging.getLogger(__name__)

class OpenAIAIService(AIServiceInterface):
    """
    AI service implementation using OpenAI's API.
    """

    def __init__(self):
        if not settings.OPENAI_API_KEY:
            raise ValueError("OpenAI API key is not configured.")
        self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.model = settings.OPENAI_MODEL

    async def generate_response(self, user_input: str) -> ParsedAIResponse:
        """
        Calls the OpenAI API to parse the user's intent and entities.
        """
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_input},
                ],
                response_format={"type": "json_object"},
            )
            
            raw_response_str = response.choices[0].message.content
            if not raw_response_str:
                raise ValueError("Received an empty response from OpenAI.")

            parsed_json = json.loads(raw_response_str)

            return ParsedAIResponse(
                intent=parsed_json.get("intent", "unknown"),
                entities=parsed_json.get("entities", {}),
                confidence=parsed_json.get("confidence", 0.0),
                original_text=user_input,
                response_text=parsed_json.get("response_text", "I'm not sure how to respond to that."),
                raw_response=parsed_json
            )

        except Exception as e:
            logger.error(f"Error communicating with OpenAI: {e}")
            raise Exception("Failed to get a valid response from the AI service.") from e 