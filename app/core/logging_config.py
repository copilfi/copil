import logging
import sys
from pythonjsonlogger import jsonlogger
from app.core.config import settings

class CustomJsonFormatter(jsonlogger.JsonFormatter):
    """
    Custom JSON formatter to add extra fields to the log record.
    """
    def add_fields(self, log_record, record, message_dict):
        super(CustomJsonFormatter, self).add_fields(log_record, record, message_dict)
        log_record['level'] = record.levelname
        log_record['name'] = record.name

def setup_logging():
    """
    Configures the root logger for the application.
    - In "production", it uses a JSON formatter.
    - In "development", it uses a simple, human-readable format.
    """
    log_level = logging.DEBUG if settings.ENVIRONMENT == "development" else logging.INFO
    
    # Get the root logger
    logger = logging.getLogger()
    logger.setLevel(log_level)

    # Remove any existing handlers
    if logger.hasHandlers():
        logger.handlers.clear()

    # Create a handler to write to standard output
    handler = logging.StreamHandler(sys.stdout)

    if settings.ENVIRONMENT == "production":
        # Use JSON formatter for production
        formatter = CustomJsonFormatter(
            '%(timestamp)s %(level)s %(name)s %(message)s'
        )
    else:
        # Use a simple formatter for development
        formatter = logging.Formatter(
            '[%(asctime)s] [%(levelname)s] [%(name)s] - %(message)s'
        )

    handler.setFormatter(formatter)
    logger.addHandler(handler)

    # Suppress verbose logging from some third-party libraries
    logging.getLogger('uvicorn.access').setLevel(logging.WARNING)
    logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
    
    # Suppress Web3 and HTTP request spam
    logging.getLogger('web3.RequestManager').setLevel(logging.WARNING)
    logging.getLogger('web3.providers.HTTPProvider').setLevel(logging.WARNING)
    logging.getLogger('urllib3.connectionpool').setLevel(logging.WARNING)
    logging.getLogger('web3._utils.request').setLevel(logging.WARNING)
    logging.getLogger('httpx').setLevel(logging.WARNING)

    logging.info(f"Logging configured for '{settings.ENVIRONMENT}' environment with level {logging.getLevelName(log_level)}.") 