from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "copil_worker",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.workers.tasks"]  # Example task module
)

celery_app.conf.update(
    task_track_started=True,
    result_expires=3600,
)

# Add Celery Beat schedule for workflow monitoring
celery_app.conf.beat_schedule = {
    'monitor-active-workflows': {
        'task': 'monitor_active_workflows',
        'schedule': 30.0,  # Run every 30 seconds
    },
    'check-pending-workflows': {
        'task': 'workflows.check_all_pending', 
        'schedule': 60.0,  # Run every 60 seconds
    },
}

if __name__ == "__main__":
    celery_app.start() 