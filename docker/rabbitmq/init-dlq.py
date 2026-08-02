"""Configure RabbitMQ dead-letter queue for publish failures.

Runs once on celery-beat or worker startup. Idempotent.
Requires RABBITMQ_URL env var set.
"""
import json
import os
import time
import urllib.request
import urllib.error
from urllib.parse import urlparse

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://viralo:***@rabbitmq:5672//")
PUBLISH_QUEUE = "viralo.post.publish"
DLQ_QUEUE = "viralo.post.publish.dlq"
DLQ_EXCHANGE = "viralo.post.publish.dlq.exchange"
DLQ_ROUTING_KEY = "viralo.post.publish.dlq"


def _parse_mgmt_url(amqp_url: str) -> str:
    """Convert amqp://user:pass@host:port// to http://user:pass@host:port/api/"""
    parsed = urlparse(amqp_url)
    pw = parsed.password or ""
    host = parsed.hostname or "rabbitmq"
    port = parsed.port or 5672
    user = parsed.username or "viralo"
    mgmt_port = 15672  # RabbitMQ management plugin port
    return f"http://{user}:{pw}@{host}:{mgmt_port}/api/"


def _api_call(mgmt_url: str, path: str, method: str = "GET", body: dict | None = None):
    url = mgmt_url.rstrip("/") + "/" + path.lstrip("/")
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()) if resp.read() else {}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        if e.code == 201:
            return {}  # created
        raise


def ensure_dlq_setup():
    """Declare DLQ exchange + queue and bind publish queue to DLX."""
    mgmt = _parse_mgmt_url(RABBITMQ_URL)

    # 1. Declare DLQ exchange
    _api_call(mgmt, "exchanges/%2f/" + DLQ_EXCHANGE, "PUT", {
        "type": "direct",
        "durable": True,
        "auto_delete": False,
    })

    # 2. Declare DLQ queue
    _api_call(mgmt, "queues/%2f/" + DLQ_QUEUE, "PUT", {
        "durable": True,
        "auto_delete": False,
        "arguments": {
            "x-message-ttl": 86400000,       # 24h TTL — don't pile up forever
            "x-max-length": 10000,            # cap at 10K dead letters
        },
    })

    # 3. Bind DLQ queue to DLQ exchange
    _api_call(mgmt, "queues/%2f/" + DLQ_QUEUE + "/bindings", "POST", {
        "exchange": DLQ_EXCHANGE,
        "routing_key": DLQ_ROUTING_KEY,
    })

    # 4. Update publish queue to use DLX
    qinfo = _api_call(mgmt, "queues/%2f/" + PUBLISH_QUEUE)
    if qinfo is None:
        # Queue doesn't exist yet (worker hasn't started) — set policy instead
        _api_call(mgmt, "policies/%2f/publish-dlq", "PUT", {
            "pattern": "^" + PUBLISH_QUEUE + "$",
            "definition": {
                "dead-letter-exchange": DLQ_EXCHANGE,
                "dead-letter-routing-key": DLQ_ROUTING_KEY,
            },
            "priority": 1,
            "apply-to": "queues",
        })
    else:
        # Queue exists — update its args via policy
        _api_call(mgmt, "policies/%2f/publish-dlq", "PUT", {
            "pattern": "^" + PUBLISH_QUEUE + "$",
            "definition": {
                "dead-letter-exchange": DLQ_EXCHANGE,
                "dead-letter-routing-key": DLQ_ROUTING_KEY,
            },
            "priority": 1,
            "apply-to": "queues",
        })

    print(f"DLQ setup complete: {PUBLISH_QUEUE} → {DLQ_EXCHANGE} → {DLQ_QUEUE}")


if __name__ == "__main__":
    # Retry a few times in case RabbitMQ mgmt isn't ready yet
    for attempt in range(5):
        try:
            ensure_dlq_setup()
            break
        except Exception as e:
            print(f"DLQ init attempt {attempt + 1} failed: {e}")
            time.sleep(3)
    else:
        print("DLQ init failed after 5 attempts — continuing anyway")