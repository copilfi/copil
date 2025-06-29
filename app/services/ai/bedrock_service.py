import boto3
from botocore.exceptions import BotoCoreError, ClientError
import json
import logging
from typing import Dict, Any

from app.core.config import settings
from app.services.ai.base import AIServiceInterface, ParsedAIResponse
from app.services.ai.prompts import SYSTEM_PROMPT

# Configure logging
logger = logging.getLogger(__name__)

class BedrockAIService(AIServiceInterface):
    """
    AI service implementation using Amazon Bedrock.
    """

    def __init__(self):
        try:
            # Using default session, expects credentials to be configured via
            # IAM role, environment variables, or ~/.aws/credentials
            self.client = boto3.client(
                "bedrock-runtime",
                region_name=settings.AWS_REGION_NAME
            )
            self.model_id = settings.BEDROCK_MODEL_ID
        except (BotoCoreError, ClientError) as e:
            logger.error(f"Failed to initialize Bedrock client: {e}")
            raise ValueError("AWS Bedrock client could not be initialized. Check credentials and region.")

    async def generate_response(self, user_input: str) -> ParsedAIResponse:
        """
        Calls the Bedrock API to parse the user's intent and entities.
        """
        # Note: The prompt structure is specific to Anthropic Claude models.
        # It needs to be adapted for other model providers.
        # The SYSTEM_PROMPT is prepended to the user's query within the Human/Assistant format.
        prompt = f"""
Human: {SYSTEM_PROMPT}

Here is the user's request: "{user_input}"

Assistant:
"""
        
        body = json.dumps({
            "prompt": prompt,
            "max_tokens_to_sample": 2048,
            "temperature": 0.7,
        })

        try:
            # Boto3 calls are synchronous, so we run it in a thread to not block the event loop.
            # In a real-world scenario with high load, you might use a thread pool executor.
            import asyncio
            loop = asyncio.get_running_loop()
            response = await loop.run_in_executor(
                None, 
                lambda: self.client.invoke_model(
                    body=body,
                    modelId=self.model_id,
                    accept='application/json',
                    contentType='application/json'
                )
            )
            
            response_body = json.loads(response.get('body').read())
            raw_response_str = response_body.get('completion')
            
            if not raw_response_str:
                raise ValueError("Received an empty completion from Bedrock.")

            # The response might contain the JSON object within a larger text, so we parse it out.
            parsed_json = json.loads(raw_response_str.strip())

            return ParsedAIResponse(
                intent=parsed_json.get("intent", "unknown"),
                entities=parsed_json.get("entities", {}),
                confidence=parsed_json.get("confidence", 0.0),
                original_text=user_input,
                response_text=parsed_json.get("response_text", "I'm not sure how to respond to that."),
                raw_response=parsed_json
            )

        except (ClientError, BotoCoreError, json.JSONDecodeError, KeyError) as e:
            logger.error(f"Error communicating with Bedrock: {e}")
            raise Exception("Failed to get a valid response from the AI service.") from e 