import os
import sys

from celery import Celery
from celery.schedules import crontab

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://viralo:viralo@rabbitmq:5672//")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

# Core/beat image has no numpy/cv2/av. Skip heavy modules for beat AND for the
# inline schedule worker (-Q viralo.post.schedule) that shares that image.
_argv = " ".join(sys.argv)
_is_light = "beat" in sys.argv or "viralo.post.schedule" in _argv

_include = [
    "workers.tasks.post",
    "workers.tasks.notification",
    "workers.tasks.websub",
    "workers.tasks.gsheet",
    "workers.tasks.webhook",
]
if not _is_light:
    _include += [
        "workers.tasks.video",
        "workers.tasks.agent",
        "workers.tasks.series",
    ]

celery_app = Celery(
    "viralo",
    broker=RABBITMQ_URL,
    backend=REDIS_URL,
    include=_include,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_soft_time_limit=3540,   # 59 min: SoftTimeLimitExceeded raised — task can clean up
    task_time_limit=3600,        # 60 min: hard SIGKILL if soft ignored
    worker_prefetch_multiplier=1,  # each worker takes 1 task at a time — prevents one worker hoarding queue
    task_acks_late=True,           # ack only after task completes — safe redelivery on worker crash
    # Restart-mid-task safety (p99): when a worker is SIGKILLed while running a task
    # (deploy/OOM/crash), requeue it instead of dropping it. Pairs with acks_late.
    task_reject_on_worker_lost=True,
    # Mark tasks STARTED so a reconciler / the UI can tell running from merely-queued.
    task_track_started=True,
    # On broker connection loss, cancel in-flight long tasks so they aren't also
    # redelivered-and-run elsewhere → prevents double processing of the same video.
    worker_cancel_long_running_tasks_on_connection_loss=True,
    broker_heartbeat=120,          # send heartbeat every 120s so RabbitMQ knows worker is alive during long ffmpeg encodes
    broker_heartbeat_checkrate=2,  # check heartbeat twice per interval
    task_routes={
        "workers.tasks.video.generate_viral_clips": {"queue": "viralo.video.ai"},
        "workers.tasks.video.process_uploaded_video": {"queue": "viralo.video.pipeline"},
        "workers.tasks.video.process_youtube_video": {"queue": "viralo.video.pipeline"},
        "workers.tasks.video.upload_clip_to_storage": {"queue": "viralo.video.upload"},
        "workers.tasks.video.concat_top_clips": {"queue": "viralo.video.generate"},
        "workers.tasks.video.merge_ai_clips": {"queue": "viralo.video.generate"},
        "workers.tasks.video.refresh_youtube_cookies": {"queue": "viralo.video.pipeline"},
        "workers.tasks.video.*": {"queue": "viralo.video.generate"},
        "workers.tasks.series.*": {"queue": "viralo.video.generate"},
        "workers.tasks.agent.*": {"queue": "viralo.agent.run"},
        "workers.tasks.workflow.*": {"queue": "viralo.workflow.execute"},
        "workers.tasks.websub.*": {"queue": "viralo.post.publish"},
        "workers.tasks.post.process_due_posts": {"queue": "viralo.post.schedule"},
        "workers.tasks.post.publish_post": {"queue": "viralo.post.publish"},
        "workers.tasks.analytics.*": {"queue": "viralo.analytics.ingest"},
        "workers.tasks.notification.*": {"queue": "viralo.notifications"},
        "workers.tasks.webhook.*": {"queue": "viralo.webhooks"},
    },
)

celery_app.conf.beat_schedule = {
    "process-due-posts": {
        "task": "workers.tasks.post.process_due_posts",
        "schedule": 60.0,
    },
    "renew-websub-subscriptions": {
        "task": "workers.tasks.websub.renew_websub_subscriptions",
        "schedule": crontab(hour=2, minute=0, day_of_month="*/3"),  # every 3rd day of month at 02:00 UTC
    },
    "refresh-youtube-cookies": {
        # Keep the YouTube session warm so cookies don't rotate out from under us.
        "task": "workers.tasks.video.refresh_youtube_cookies",
        "schedule": crontab(minute="*/25"),  # every 25 min — under YouTube's rotation cadence
    },
    "prune-source-cache": {
        # Evict cached YouTube sources past their TTL so storage doesn't grow unbounded.
        "task": "workers.tasks.video.prune_source_cache",
        "schedule": crontab(hour=4, minute=0),  # daily at 04:00 UTC
    },
    "process-due-series": {
        # Faceless-video series: launch generation jobs for series whose run is due
        # (GENERATION_LEAD_HOURS before their scheduled publish time).
        "task": "workers.tasks.series.process_due_series",
        "schedule": crontab(minute="*/5"),
    },
    "reconcile-stuck-videos": {
        # Backstop: re-enqueue / fail videos orphaned by a worker crash or restart
        # so none stay wedged in 'processing'/'queued' forever.
        "task": "workers.tasks.video.reconcile_stuck_videos",
        "schedule": crontab(minute="*/10"),  # every 10 min
    },
}
