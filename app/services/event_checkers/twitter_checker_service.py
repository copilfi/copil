import logging
import tweepy
from typing import Dict, Any, Tuple

from app.models.workflow import Workflow
from app.core.config import settings

logger = logging.getLogger(__name__)

class TwitterCheckerService:
    """
    Checks for new events from Twitter.
    """
    def __init__(self):
        if not settings.TWITTER_BEARER_TOKEN:
            raise ValueError("TWITTER_BEARER_TOKEN is not configured.")
        self.client = tweepy.Client(bearer_token=settings.TWITTER_BEARER_TOKEN)

    async def check(self, workflow: Workflow) -> Tuple[bool, Dict[str, Any]]:
        """
        Checks for a new event based on the workflow's trigger_config.

        :param workflow: The workflow instance.
        :return: A tuple containing:
                 - bool: True if a new event is found, False otherwise.
                 - dict: The updated state to be stored in the workflow.
        """
        config = workflow.trigger_config
        params = config.get("params", {})
        event_type = params.get("type")

        if event_type == "user_tweets":
            return await self._check_user_tweets(workflow, params)
        # Add other event types like 'search_term' here in the future
        else:
            logger.warning(f"Unsupported Twitter event type: '{event_type}' for workflow {workflow.id}")
            return False, workflow.state

    async def _check_user_tweets(self, workflow: Workflow, params: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        """
        Checks for the latest tweet from a specific user.
        """
        state = workflow.state or {}
        username = params.get("username")
        if not username:
            logger.warning(f"No 'username' provided for user_tweets check in workflow {workflow.id}")
            return False, state

        last_tweet_id = state.get("last_tweet_id")

        try:
            # Get user ID from username
            user_response = self.client.get_user(username=username)
            if not user_response.data:
                logger.error(f"Twitter user not found: {username} for workflow {workflow.id}")
                return False, state
            user_id = user_response.data.id

            # Get the most recent tweet from the user
            tweets_response = self.client.get_users_tweets(id=user_id, since_id=last_tweet_id, max_results=5)

            if not tweets_response.data:
                # No new tweets
                return False, state

            # The API returns tweets in reverse chronological order. The first one is the newest.
            latest_tweet = tweets_response.data[0]
            newest_tweet_id = latest_tweet.id

            logger.info(f"New tweet found for user '{username}' in workflow {workflow.id}. Tweet ID: {newest_tweet_id}")
            
            new_state = {"last_tweet_id": str(newest_tweet_id)}
            return True, new_state

        except tweepy.errors.TweepyException as e:
            logger.error(f"Twitter API error for workflow {workflow.id}: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"An unexpected error occurred during Twitter check for workflow {workflow.id}: {e}", exc_info=True)
            
        return False, state 