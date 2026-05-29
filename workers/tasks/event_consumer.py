"""RabbitMQ fanout consumer — routes domain events to notification tasks."""
import asyncio
import json
import logging
import os

import aio_pika

from workers.tasks.notification import send_notification

logger = logging.getLogger(__name__)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://viralo:viralo@rabbitmq:5672//")
FANOUT_EXCHANGE = "viralo.fanout"


def _dispatch(event_type: str, payload: dict) -> None:
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        logger.warning("event_consumer: missing tenant_id in payload for event %s", event_type)
        return

    if event_type == "video.ready":
        send_notification.delay(
            tenant_id,
            user_id=None,
            type="video_ready",
            title="Your video is ready",
            body=f"'{payload.get('title', '')}' finished processing.",
            action_url=f"/studio/{payload.get('video_id')}",
            metadata={"video_id": payload.get("video_id")},
        )
    elif event_type == "session.complete":
        send_notification.delay(
            tenant_id,
            None,
            "session_complete",
            "Brainstorm complete",
            f"Session '{payload.get('name', '')}' finished.",
            action_url=f"/brainstorm/{payload.get('session_id')}",
            metadata={"session_id": payload.get("session_id")},
        )
    elif event_type == "workflow.run.complete":
        send_notification.delay(
            tenant_id,
            None,
            "workflow_complete",
            "Workflow run finished",
            f"Workflow '{payload.get('name', '')}' completed.",
            action_url=f"/workflows/{payload.get('workflow_id')}/runs/{payload.get('run_id')}",
            metadata=payload,
        )
    elif event_type == "workflow.run.failed":
        send_notification.delay(
            tenant_id,
            None,
            "workflow_complete",
            "Workflow run failed",
            f"Workflow '{payload.get('name', '')}' failed.",
            action_url=f"/workflows/{payload.get('workflow_id')}/runs/{payload.get('run_id')}",
            metadata=payload,
        )
    elif event_type == "quota.exceeded":
        send_notification.delay(
            tenant_id,
            None,
            "quota_warning",
            "Quota limit reached",
            "You've hit your monthly limit. Upgrade to continue.",
            action_url="/settings/billing",
            metadata=payload,
        )
    else:
        logger.debug("event_consumer: unhandled event type %s", event_type)


async def main() -> None:
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    async with connection:
        channel = await connection.channel()
        exchange = await channel.declare_exchange(FANOUT_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True)
        queue = await channel.declare_queue(exclusive=True)
        await queue.bind(exchange)

        logger.info("event_consumer: listening on fanout exchange %s", FANOUT_EXCHANGE)

        async with queue.iterator() as queue_iter:
            async for message in queue_iter:
                async with message.process():
                    try:
                        data = json.loads(message.body.decode())
                        event_type = data.get("event", "")
                        payload = data.get("payload", {})
                        _dispatch(event_type, payload)
                    except Exception:
                        logger.exception("event_consumer: failed to process message")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
