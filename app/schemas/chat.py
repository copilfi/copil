from pydantic import BaseModel, Field
from typing import List, Optional, Dict

class ChatMessage(BaseModel):
    """Represents a single message in a conversation history."""
    role: str = Field(..., description="The role of the sender, e.g., 'user' or 'assistant'.")
    content: str = Field(..., description="The text content of the message.")

class ChatRequest(BaseModel):
    """The request model for the chat endpoint."""
    message: str = Field(..., description="The user's current message.", max_length=5000)
    history: Optional[List[ChatMessage]] = Field(None, description="The preceding conversation history.")

class ChatResponse(BaseModel):
    """The response model for the chat endpoint."""
    content: str = Field(..., description="The AI-generated response content.")
    provider: str = Field(..., description="The AI provider that generated the response, e.g., 'bedrock' or 'openai'.")
    model: str = Field(..., description="The specific model used for the response.")
    cost: Optional[float] = Field(None, description="The estimated cost of the generation in USD.")
    latency_ms: Optional[int] = Field(None, description="The time taken to generate the response in milliseconds.") 