import os

from celery import Celery
from celery.schedules import crontab

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://viralo:viralo@rabbitmq:5672//")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery(
    "viralo",
    broker=RABBITMQ_URL,
    backend=REDIS_URL,
    include=[
        "workers.tasks.video",
        "workers.tasks.agent",
        "workers.tasks.post",
        "workers.tasks.analytics",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "workers.tasks.video.*": {"queue": "viralo.video.generate"},
        "workers.tasks.agent.*": {"queue": "viralo.agent.run"},
        "workers.tasks.workflow.*": {"queue": "viralo.workflow.execute"},
        "workers.tasks.post.*": {"queue": "viralo.post.publish"},
        "workers.tasks.analytics.*": {"queue": "viralo.analytics.ingest"},
    },
)

celery_app.conf.beat_schedule = {
    "process-due-posts": {
        "task": "workers.tasks.post.process_due_posts",
        "schedule": 60.0,  # every 60 seconds
    },
    "refresh-analytics": {
        "task": "workers.tasks.analytics.refresh_analytics",
        "schedule": crontab(minute=0, hour="*/4"),  # every 4 hours
    },
}
