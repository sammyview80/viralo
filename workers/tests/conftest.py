"""Stub out module-level heavy dependencies before video.py is imported."""
import sys
from unittest.mock import MagicMock

# These are imported at module scope in video.py and will fail without real infra
for mod in [
    "redis",
    "sqlalchemy",
    "sqlalchemy.orm",
    "workers.celery_app",
    "celery",
    "celery.app",
]:
    sys.modules.setdefault(mod, MagicMock())

# create_engine and redis.from_url are called at module scope — make them no-ops
import sqlalchemy as _sa
_sa.create_engine = MagicMock(return_value=MagicMock())
import redis as _redis
_redis.from_url = MagicMock(return_value=MagicMock())
