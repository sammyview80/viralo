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
        "workers.tasks.notification",
        "workers.tasks.websub",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_soft_time_limit=1200,   # 20 min: SoftTimeLimitExceeded raised — task can clean up
    task_time_limit=1260,        # 21 min: hard SIGKILL if soft ignored
    worker_prefetch_multiplier=1,  # each worker takes 1 task at a time — prevents one worker hoarding queue
    task_acks_late=True,           # ack only after task completes — safe redelivery on worker crash
    task_routes={
        "workers.tasks.video.generate_viral_clips": {"queue": "viralo.video.ai"},
        "workers.tasks.video.process_uploaded_video": {"queue": "viralo.video.pipeline"},
        "workers.tasks.video.process_youtube_video": {"queue": "viralo.video.pipeline"},
        "workers.tasks.video.upload_clip_to_storage": {"queue": "viralo.video.upload"},
        "workers.tasks.video.*": {"queue": "viralo.video.generate"},
        "workers.tasks.agent.*": {"queue": "viralo.agent.run"},
        "workers.tasks.workflow.*": {"queue": "viralo.workflow.execute"},
        "workers.tasks.post.*": {"queue": "viralo.post.publish"},
        "workers.tasks.analytics.*": {"queue": "viralo.analytics.ingest"},
        "workers.tasks.notification.*": {"queue": "viralo.notifications"},
    },
)

celery_app.conf.beat_schedule = {
    "process-due-posts": {
        "task": "workers.tasks.post.process_due_posts",
        "schedule": 60.0,
    },
    "renew-websub-subscriptions": {
        "task": "workers.tasks.websub.renew_websub_subscriptions",
        "schedule": crontab(hour=2, minute=0, day_of_week="*/3"),  # every 3 days at 02:00 UTC
    },
}
