import logging
import feedparser
from datetime import datetime
from typing import Dict, Any, Tuple

from app.models.workflow import Workflow

logger = logging.getLogger(__name__)

class RssCheckerService:
    """
    Checks for new entries in an RSS feed.
    """
    async def check(self, workflow: Workflow) -> Tuple[bool, Dict[str, Any]]:
        """
        Checks the RSS feed specified in the workflow's trigger_config.

        :param workflow: The workflow instance.
        :return: A tuple containing:
                 - bool: True if a new entry is found, False otherwise.
                 - dict: The updated state to be stored in the workflow.
        """
        config = workflow.trigger_config
        state = workflow.state or {}
        
        feed_url = config.get("params", {}).get("feed_url")
        if not feed_url:
            logger.warning(f"No feed_url configured for workflow {workflow.id}")
            return False, state

        last_entry_timestamp = state.get("last_entry_timestamp", 0)

        try:
            feed = feedparser.parse(feed_url)
            if feed.bozo:
                logger.error(f"Failed to parse RSS feed for workflow {workflow.id}. URL: {feed_url}. Error: {feed.bozo_exception}")
                return False, state

            if not feed.entries:
                return False, state

            # Find the latest entry in the current feed
            latest_entry = max(feed.entries, key=lambda entry: self._get_entry_timestamp(entry))
            latest_entry_timestamp = self._get_entry_timestamp(latest_entry)

            # Check if there is a new entry since the last check
            if latest_entry_timestamp > last_entry_timestamp:
                logger.info(f"New RSS entry found for workflow {workflow.id}. Title: '{latest_entry.title}'")
                
                # Update the state with the timestamp of the newest entry found
                new_state = {"last_entry_timestamp": latest_entry_timestamp}
                return True, new_state

        except Exception as e:
            logger.error(f"Error checking RSS feed for workflow {workflow.id}: {e}", exc_info=True)
        
        return False, state

    def _get_entry_timestamp(self, entry) -> float:
        """
        Extracts a timestamp from an RSS feed entry.
        """
        if hasattr(entry, 'published_parsed') and entry.published_parsed:
            return datetime(*entry.published_parsed[:6]).timestamp()
        if hasattr(entry, 'updated_parsed') and entry.updated_parsed:
            return datetime(*entry.updated_parsed[:6]).timestamp()
        # Fallback to current time if no date is found, though this is not ideal
        return datetime.now().timestamp() 