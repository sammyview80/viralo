"""Stub out module-level heavy dependencies before video.py is imported."""
import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / "shared"
for path in (ROOT, SHARED):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

# These are imported at module scope in video.py. Prefer the real packages when
# installed so this conftest does not shadow packages used by other test suites.
for mod in ["redis", "sqlalchemy", "sqlalchemy.orm", "workers.celery_app", "celery", "celery.app"]:
    if importlib.util.find_spec(mod) is None:
        sys.modules.setdefault(mod, MagicMock())

# create_engine and redis.from_url are called at module scope — make them no-ops
_sa = importlib.import_module("sqlalchemy")
_sa.create_engine = MagicMock(return_value=MagicMock())
_redis = importlib.import_module("redis")
_redis.from_url = MagicMock(return_value=MagicMock())
