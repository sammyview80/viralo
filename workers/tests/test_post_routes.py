"""Regression: post scheduler must not share the publish worker queue."""
import importlib
import sys


def test_process_due_posts_routes_to_schedule_queue():
    from workers.celery_app import celery_app

    assert celery_app.conf.task_routes["workers.tasks.post.process_due_posts"] == {
        "queue": "viralo.post.schedule",
    }


def test_publish_post_routes_to_publish_queue():
    from workers.celery_app import celery_app

    assert celery_app.conf.task_routes["workers.tasks.post.publish_post"] == {
        "queue": "viralo.post.publish",
    }


def test_post_wildcard_does_not_steal_scheduler_route():
    from workers.celery_app import celery_app

    routes = celery_app.conf.task_routes
    assert "workers.tasks.post.*" not in routes


def test_schedule_queue_worker_uses_light_includes(monkeypatch):
    """Core/beat image worker must not pull video/agent/series modules."""
    monkeypatch.setattr(
        sys,
        "argv",
        ["celery", "-A", "workers.celery_app", "worker", "-Q", "viralo.post.schedule"],
    )
    import workers.celery_app as mod

    importlib.reload(mod)
    try:
        assert "workers.tasks.video" not in mod.celery_app.conf.include
        assert "workers.tasks.post" in mod.celery_app.conf.include
    finally:
        monkeypatch.setattr(sys, "argv", ["pytest"])
        importlib.reload(mod)
