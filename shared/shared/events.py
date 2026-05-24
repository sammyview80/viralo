import json
import os
from typing import Any
import aio_pika

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://viralo:viralo@rabbitmq:5672//")


async def publish_event(
    event_type: str,
    payload: dict[str, Any],
    queue: str | None = None,
    exchange: str = "",
) -> None:
    """Publish a message to RabbitMQ. Uses default exchange (direct to queue) or named exchange."""
    connection = await aio_pika.connect_robust(RABBITMQ_URL)
    async with connection:
        channel = await connection.channel()
        message = aio_pika.Message(
            body=json.dumps({"event": event_type, "payload": payload}).encode(),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        )
        if exchange:
            exch = await channel.get_exchange(exchange)
            await exch.publish(message, routing_key=queue or "")
        else:
            await channel.default_exchange.publish(message, routing_key=queue or event_type)
