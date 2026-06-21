"""Generate and write pre-baked WAV files for editor sound effects."""
import math
import os
import random
import struct
import wave
from pathlib import Path

SOUNDS_DIR = Path(__file__).parent.parent / "assets" / "sounds"
SAMPLE_RATE = 44100


def _write_wav(path: Path, samples: list[float]) -> None:
    clamped = [max(-1.0, min(1.0, s)) for s in samples]
    pcm = struct.pack(f"<{len(clamped)}h", *[int(s * 32767) for s in clamped])
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(pcm)


def _sine(freq: float, dur: float, amp: float = 0.5) -> list[float]:
    n = int(SAMPLE_RATE * dur)
    return [amp * math.sin(2 * math.pi * freq * i / SAMPLE_RATE) for i in range(n)]


def _env(samples: list[float], attack: float, release: float) -> list[float]:
    n = len(samples)
    atk = int(SAMPLE_RATE * attack)
    rel = int(SAMPLE_RATE * release)
    out = list(samples)
    for i in range(min(atk, n)):
        out[i] *= i / atk
    for i in range(max(0, n - rel), n):
        out[i] *= (n - i) / rel
    return out


def gen_ding() -> list[float]:
    s = _sine(1047, 0.9, 0.5)
    return _env(s, 0.005, 0.7)


def gen_quack() -> list[float]:
    n = int(SAMPLE_RATE * 0.22)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 900 * math.exp(-t / 0.1 * math.log(3))
        out.append(0.5 * (1 if math.sin(2 * math.pi * freq * t) > 0 else -1))
    return _env(out, 0.002, 0.05)


def gen_applause() -> list[float]:
    n = int(SAMPLE_RATE * 0.9)
    random.seed(42)
    out = []
    for i in range(n):
        env = i / (SAMPLE_RATE * 0.3) if i < SAMPLE_RATE * 0.3 else 1 - (i - SAMPLE_RATE * 0.3) / (SAMPLE_RATE * 0.6)
        out.append((random.random() * 2 - 1) * env * 0.5)
    return out


def gen_airhorn() -> list[float]:
    n = int(SAMPLE_RATE * 0.5)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 220 + (440 - 220) * min(t / 0.06, 1)
        out.append(0.35 * (1 if math.sin(2 * math.pi * freq * t) > 0 else -1))
    return _env(out, 0.002, 0.3)


def gen_womp() -> list[float]:
    n = int(SAMPLE_RATE * 0.65)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        freq = 400 * math.exp(-t / 0.65 * math.log(8))
        out.append(0.4 * (1 if math.sin(2 * math.pi * freq * t) > 0 else -1))
    return _env(out, 0.002, 0.1)


def gen_tada() -> list[float]:
    freqs = [523, 659, 784, 1047]
    total = int(SAMPLE_RATE * (0.1 * len(freqs) + 0.4))
    out = [0.0] * total
    for idx, freq in enumerate(freqs):
        start = int(SAMPLE_RATE * idx * 0.1)
        seg = _env(_sine(freq, 0.4, 0.35), 0.01, 0.3)
        for j, v in enumerate(seg):
            if start + j < total:
                out[start + j] += v
    return out


GENERATORS = {
    "ding": gen_ding,
    "quack": gen_quack,
    "applause": gen_applause,
    "airhorn": gen_airhorn,
    "womp": gen_womp,
    "tada": gen_tada,
}


def ensure_sounds() -> None:
    SOUNDS_DIR.mkdir(parents=True, exist_ok=True)
    for name, fn in GENERATORS.items():
        path = SOUNDS_DIR / f"{name}.wav"
        if not path.exists():
            _write_wav(path, fn())


if __name__ == "__main__":
    ensure_sounds()
    print(f"Generated WAVs in {SOUNDS_DIR}")
