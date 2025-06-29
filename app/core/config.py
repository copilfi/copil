from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional, Dict, Any
import secrets
from functools import lru_cache
from dotenv import load_dotenv
from pydantic import validator, Field
import logging
import os

# Load .env file before settings are initialized
load_dotenv()

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Application settings with environment variable support"""
    
    model_config = SettingsConfigDict(
        env_file=f".env.{os.getenv('ENVIRONMENT', 'dev')}", 
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore'  # Ignore extra fields from .env file
    )
    
    # Basic Application Settings
    APP_NAME: str = "Copil"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SECRET_KEY: str = secrets.token_urlsafe(32)
    
    # Security
    ALLOWED_HOSTS: List[str] = ["*"]
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:8000"]
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    
    # Database Settings
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://localhost:5432/copil_dev")
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 0
    DATABASE_ECHO: bool = False
    
    # Redis Settings  
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_CACHE_TTL: int = 300  # 5 minutes default
    
    # Celery Settings
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"
    ENABLE_BACKGROUND_TASKS: bool = True
    
    # External API Settings - OneBalance
    ONEBALANCE_API_URL: str = "https://api.onebalance.io"
    ONEBALANCE_API_KEY: str = os.getenv("ONEBALANCE_API_KEY", "")
    ONEBALANCE_WEBHOOK_SECRET: Optional[str] = None
    
    # External API Settings - Privy
    PRIVY_APP_ID: str = os.getenv("PRIVY_APP_ID", "")
    PRIVY_APP_SECRET: str = os.getenv("PRIVY_APP_SECRET", "")
    PRIVY_VERIFICATION_KEY: str = os.getenv("PRIVY_VERIFICATION_KEY", "")
    
    # AI Services - OpenAI
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4-turbo-preview"
    OPENAI_MAX_TOKENS: int = 2000
    OPENAI_TEMPERATURE: float = 0.7
    
    # AI Services - Amazon Bedrock
    AWS_REGION_NAME: str = "us-east-1"
    BEDROCK_MODEL_ID: str = "anthropic.claude-v2"
    
    # Secure Vault - AWS KMS
    AWS_KMS_KEY_ID: Optional[str] = Field(default=None, description="The Key ID for the AWS KMS key used to encrypt/decrypt session keys.")
    
    # AI Cost Management
    AI_COST_LIMIT_DAILY_USD: float = 100.0
    AI_CALLS_PER_USER_DAILY_FREE: int = 10
    AI_CALLS_PER_USER_DAILY_PRO: int = 100
    
    # Market Data APIs
    COINGECKO_BASE_URL: str = "https://api.coingecko.com/api/v3"
    DEXSCREENER_API_KEY: Optional[str] = None
    MARKET_DATA_CACHE_TTL: int = 300  # 5 minutes
    
    # Monitoring & Logging
    SENTRY_DSN: Optional[str] = None
    LOG_LEVEL: str = "INFO"
    PROMETHEUS_ENABLED: bool = True
    PROMETHEUS_PORT: int = 8001
    
    # Rate Limiting
    RATE_LIMIT_PER_MINUTE: int = 60
    RATE_LIMIT_PER_HOUR: int = 1000
    RATE_LIMIT_PER_DAY: int = 10000
    
    # Circuit Breaker Settings
    CIRCUIT_BREAKER_FAILURE_THRESHOLD: int = 5
    CIRCUIT_BREAKER_RECOVERY_TIMEOUT: int = 300  # 5 minutes
    CIRCUIT_BREAKER_EXPECTED_EXCEPTION: tuple = (Exception,)
    
    # Security Settings
    PASSWORD_MIN_LENGTH: int = 8
    SESSION_COOKIE_SECURE: bool = True
    SESSION_COOKIE_HTTPONLY: bool = True
    SESSION_COOKIE_SAMESITE: str = "lax"
    
    # Notification Settings
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_TLS: bool = True
    
    TELEGRAM_BOT_TOKEN: Optional[str] = None
    TELEGRAM_WEBHOOK_URL: Optional[str] = None
    
    # Risk Management
    MAX_WORKFLOW_EXECUTIONS_PER_USER_DAILY: int = 100
    MAX_TRANSACTION_VALUE_USD: float = 50000.0
    SUSPICIOUS_ACTIVITY_THRESHOLD: int = 10
    
    # Feature Flags
    ENABLE_AI_CHAT: bool = True
    ENABLE_WORKFLOW_BUILDER: bool = True
    ENABLE_CROSS_CHAIN: bool = True
    ENABLE_ADVANCED_ANALYTICS: bool = True
    
    # Development/Testing
    TEST_DATABASE_URL: Optional[str] = None
    MOCK_EXTERNAL_APIS: bool = False
    PRIVATE_KEY: Optional[str] = Field(default=None, description="The private key for the development signer. DO NOT USE IN PRODUCTION.")
    
    # --- AI Service Configuration ---
    # Primary AI provider can be "bedrock" or "openai"
    PRIMARY_AI_PROVIDER: str = "bedrock"
    
    # --- Blockchain Node Configuration ---
    # This key is loaded from the .env file and used to build the RPC URLs.
    ALCHEMY_API_KEY: Optional[str] = None

    ETHEREUM_RPC_URL: Optional[str] = None
    AVALANCHE_RPC_URL: Optional[str] = None
    AVALANCHE_FUJI_RPC_URL: Optional[str] = None
    BASE_RPC_URL: Optional[str] = None
    
    # --- Avalanche Fuji Testnet MVP Configuration ---
    # Smart Contract addresses for MVP testing
    FUJI_WORKFLOW_MANAGER_ADDRESS: Optional[str] = Field(default=None, description="Deployed WorkflowManager proxy address on Fuji")
    FUJI_AUTOMATION_REGISTRY: str = "0x819B58A646CDd8289275A87653a2aA4902b14fe6"  # Chainlink Automation v2.3
    FUJI_LINK_TOKEN: str = "0x0b9d5D9136855f6FEc3c0993feE6E9CE8a297846"
    FUJI_AVAX_USD_PRICE_FEED: str = "0x31CF013A08c6Ac228C94551d535d5BAfE19c602a"
    
    # Fuji Network Configuration
    FUJI_CHAIN_ID: int = 43113
    FUJI_RPC_URL_DEFAULT: str = "https://api.avax-test.network/ext/bc/C/rpc"
    FUJI_EXPLORER_URL: str = "https://testnet.snowtrace.io"
    
    @validator("ETHEREUM_RPC_URL", pre=True)
    def assemble_ethereum_rpc_url(cls, v, values):
        if isinstance(v, str):
            return v
        api_key = values.get("ALCHEMY_API_KEY")
        if not api_key:
            logger.warning("ALCHEMY_API_KEY not set. Blockchain services requiring Ethereum may fail.")
            return None
        return f"https://eth-mainnet.g.alchemy.com/v2/{api_key}"

    @validator("AVALANCHE_RPC_URL", pre=True)
    def assemble_avalanche_rpc_url(cls, v, values):
        if isinstance(v, str):
            return v
        api_key = values.get("ALCHEMY_API_KEY")
        if not api_key:
            logger.warning("ALCHEMY_API_KEY not set. Blockchain services requiring Avalanche may fail.")
            return None
        return f"https://avax-mainnet.g.alchemy.com/v2/{api_key}"

    @validator("AVALANCHE_FUJI_RPC_URL", pre=True)
    def assemble_avalanche_fuji_rpc_url(cls, v, values):
        if isinstance(v, str):
            return v
        # For Fuji testnet, use default public RPC
        return values.get("FUJI_RPC_URL_DEFAULT", "https://api.avax-test.network/ext/bc/C/rpc")

    @validator("BASE_RPC_URL", pre=True)
    def assemble_base_rpc_url(cls, v, values):
        if isinstance(v, str):
            return v
        api_key = values.get("ALCHEMY_API_KEY")
        if not api_key:
            logger.warning("ALCHEMY_API_KEY not set. Blockchain services requiring Base may fail.")
            return None
        return f"https://base-mainnet.g.alchemy.com/v2/{api_key}"

    # --- Third-Party API Keys ---
    COINGECKO_API_KEY: Optional[str] = None

    # TWITTER
    TWITTER_BEARER_TOKEN: str = os.getenv("TWITTER_BEARER_TOKEN", "")

    # WEB3
    # This URL can be from any provider like Alchemy, Infura, etc.
    EVM_RPC_URL: Optional[str] = os.getenv("EVM_RPC_URL", None)
    ETHERSCAN_API_KEY: str = os.getenv("ETHERSCAN_API_KEY", "")

    # --- Event Listener & Web3 Settings ---
    ENABLE_EVENT_LISTENER: bool = Field(default=False, description="Set to True to enable the on-chain event listener.")
    LISTENER_POLL_INTERVAL: int = Field(default=15, description="Interval in seconds for the event listener to poll for new blocks.")
    WEB3_PROVIDER_URI: Optional[str] = Field(default=None, description="RPC URI for the blockchain node.")
    WORKFLOW_MANAGER_CONTRACT_ADDRESS: Optional[str] = Field(default=None, description="Address of the deployed WorkflowManager contract.")

    def get_database_url(self, async_driver: bool = True) -> str:
        """Get database URL with appropriate driver"""
        if async_driver:
            return self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
        return self.DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://")
    
    def is_production(self) -> bool:
        """Check if running in production environment"""
        return self.ENVIRONMENT.lower() == "production"
    
    def is_development(self) -> bool:
        """Check if running in development environment"""
        return self.ENVIRONMENT.lower() == "development"
    
    def get_cors_origins(self) -> List[str]:
        """Get CORS origins based on environment"""
        if self.is_production():
            return [origin for origin in self.ALLOWED_ORIGINS if not origin.startswith("http://localhost")]
        return self.ALLOWED_ORIGINS
    
    def get_ai_cost_limit_for_tier(self, tier: str) -> dict:
        """Get AI usage limits based on user tier"""
        limits = {
            "free": {
                "daily_calls": self.AI_CALLS_PER_USER_DAILY_FREE,
                "cost_limit_usd": 5.0,
                "features": ["basic_chat", "simple_workflows"]
            },
            "pro": {
                "daily_calls": self.AI_CALLS_PER_USER_DAILY_PRO,
                "cost_limit_usd": 25.0,
                "features": ["advanced_chat", "complex_workflows", "market_analysis"]
            },
            "enterprise": {
                "daily_calls": -1,  # Unlimited
                "cost_limit_usd": -1,  # Unlimited
                "features": ["all"]
            }
        }
        return limits.get(tier, limits["free"])


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()


# Global settings instance
settings = get_settings() 