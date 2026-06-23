"""
Video processing pipeline — ClipForge-based.
PyAV for video I/O (no ffmpeg needed for clip export/audio).
Groq Whisper (word timestamps) + Groq LLaMA for AI scoring.
Pillow for caption burn-in.
ffmpeg still used for YouTube download + metadata probe fallback.
"""
import asyncio
import io
import json
import logging
import os
import re
import shutil
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass, field, replace as dataclass_replace
from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Optional

import redis
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app


from workers.tasks.video._core import *  # noqa: F401,F403
from workers.tasks.video.cookies import *  # noqa: F401,F403
from workers.tasks.video.transcribe import *  # noqa: F401,F403
from workers.tasks.video.ai import *  # noqa: F401,F403
from workers.tasks.video.render import *  # noqa: F401,F403
from workers.tasks.video.download import *  # noqa: F401,F403
from workers.tasks.video.pipeline import *  # noqa: F401,F403
from workers.tasks.video.tasks import *  # noqa: F401,F403
