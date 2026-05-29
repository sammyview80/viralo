# LLM Cost Analysis — Viralo Video Pipeline

## Pipeline Overview

Every video processed triggers **22 LLM calls** across 4 pipeline stages.

### Calls Per Video (default: 5 clips, 3 platforms)

| Stage | Function | Calls | Input Tokens | Output Tokens | Description |
|-------|----------|-------|-------------|---------------|-------------|
| Video metadata | `_ai_generate_video_metadata` | 1 | ~2,000 | ~1,000 | Full transcript → summary, topics, content type |
| Viral signal detection | `_multi_agent_viral_signals` | 4 parallel | ~10,000 | ~6,000 | hook_hunter, emotion_detector, info_density, controversy agents |
| Clip builder | `_ai_score_clips` stage 2 | 1 | ~3,000 | ~2,000 | Signals → timestamped clips |
| Per-clip content × 5 clips | `_multi_agent_clip_content` | 15 (3×5) | ~22,500 | ~8,000 | Description + hashtag research + title optimizer per clip |
| Merge decision | `run_video_pipeline` | 1 | ~500 | ~600 | Decides which clips to merge |
| **Total** | | **22** | **~38,000** | **~17,600** | **~55,600 tokens/video** |

---

## Cost by Provider

### Currently Integrated

| Provider | Model | Input $/1M | Output $/1M | Cost/video | Monthly (1K videos) |
|----------|-------|-----------|------------|------------|---------------------|
| Azure OpenAI | gpt-4o | $2.50 | $10.00 | **~$0.27** | ~$270 |
| Azure OpenAI | gpt-4o-mini | $0.15 | $0.60 | **~$0.017** | ~$17 |
| Azure OpenAI | gpt-4.1 | $2.00 | $8.00 | **~$0.217** | ~$217 |
| Azure OpenAI | gpt-4.1-mini | $0.40 | $1.60 | **~$0.043** | ~$43 |
| Azure OpenAI | **gpt-4.1-nano** ⭐ | $0.10 | $0.40 | **~$0.011** | ~$11 |
| Groq | llama-3.3-70b-versatile | $0.59 | $0.79 | **~$0.036** | ~$36 |
| Groq | llama-3.1-8b-instant | $0.05 | $0.08 | **~$0.003** | ~$3 |
| Cerebras | qwen-3-235b | $0.30 | $1.20 | **~$0.032** | ~$32 |
| SambaNova | Llama-3.3-70B | $0.40 | $0.80 | **~$0.029** | ~$29 |
| OpenRouter | gemma-4-31b:free | $0 | $0 | **$0** | $0 |
| OpenRouter | deepseek-v4-flash:free | $0 | $0 | **$0** | $0 |

### Recommended Addition: Cheap Paid Providers

| Provider | Model | Input $/1M | Output $/1M | Cost/video | Why Add |
|----------|-------|-----------|------------|------------|---------|
| **Together AI** | Llama-3.3-70B-Instruct-Turbo | $0.18 | $0.18 | **~$0.010** | Fastest 70B, consistent JSON |
| **Together AI** | Llama-3.1-8B-Instruct-Turbo | $0.018 | $0.018 | **~$0.001** | Cheapest reliable option |
| **Fireworks AI** | Llama-3.3-70B | $0.20 | $0.20 | **~$0.011** | High reliability, OpenAI-compat |
| **Fireworks AI** | Llama-3.1-8B | $0.016 | $0.016 | **~$0.001** | Near-free, good for hashtags/titles |
| **Deepseek** | deepseek-chat (V3) | $0.07 | $1.10 | **~$0.022** | Best quality/cost for long reasoning |
| **Deepseek** | deepseek-reasoner (R1) | $0.55 | $2.19 | **~$0.059** | Best for viral signal detection |
| **Mistral AI** | mistral-small-latest | $0.10 | $0.30 | **~$0.009** | Fast, cheap, reliable JSON |
| **Mistral AI** | mistral-large-latest | $2.00 | $6.00 | **~$0.181** | GPT-4 quality at lower cost |
| **Cohere** | command-r | $0.15 | $0.60 | **~$0.016** | Good RAG, structured output |
| **Cohere** | command-r-plus | $2.50 | $10.00 | **~$0.270** | Same as gpt-4o |
| **Google Vertex** | gemini-1.5-flash | $0.075 | $0.30 | **~$0.008** | Cheapest quality model available |
| **Google Vertex** | gemini-2.0-flash | $0.10 | $0.40 | **~$0.011** | Fast, multimodal, excellent JSON |
| **Hyperbolic** | Llama-3.3-70B | $0.20 | $0.20 | **~$0.011** | OpenAI-compat, good free credits |
| **Novita AI** | Llama-3.3-70B | $0.08 | $0.08 | **~$0.004** | One of cheapest 70B providers |
| **Novita AI** | Llama-3.1-8B | $0.01 | $0.01 | **~$0.001** | Near-zero cost fallback |

---

## Integration Guide

All providers below use OpenAI-compatible API (`/v1/chat/completions`). Add to `shared/shared/llm.py` `_BASE_PROVIDERS` list.

### Together AI
```
env: TOGETHER_API_KEY
base_url: https://api.together.xyz/v1
models: meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo | meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo
json_mode: True
```

### Fireworks AI
```
env: FIREWORKS_API_KEY
base_url: https://api.fireworks.ai/inference/v1
models: accounts/fireworks/models/llama-v3p3-70b-instruct | accounts/fireworks/models/llama-v3p1-8b-instruct
json_mode: True
```

### Deepseek
```
env: DEEPSEEK_API_KEY
base_url: https://api.deepseek.com/v1
models: deepseek-chat | deepseek-reasoner
json_mode: True
```

### Mistral AI
```
env: MISTRAL_API_KEY
base_url: https://api.mistral.ai/v1
models: mistral-large-latest | mistral-small-latest
json_mode: True
```

### Google Gemini (OpenAI-compat endpoint)
```
env: GEMINI_API_KEY
base_url: https://generativelanguage.googleapis.com/v1beta/openai
models: gemini-2.0-flash | gemini-1.5-flash
json_mode: False  (use response_mime_type instead — needs custom handling)
```

### Novita AI
```
env: NOVITA_API_KEY
base_url: https://api.novita.ai/v3/openai
models: meta-llama/llama-3.3-70b-instruct | meta-llama/llama-3.1-8b-instruct
json_mode: True
```

### Hyperbolic
```
env: HYPERBOLIC_API_KEY
base_url: https://api.hyperbolic.xyz/v1
models: meta-llama/Llama-3.3-70B-Instruct | meta-llama/Llama-3.1-8B-Instruct
json_mode: True
```

---

## Cost Optimization Strategies

### 1. Use gpt-4.1-nano instead of gpt-4o (immediate, best option)
```
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4.1-nano
```
Saves 25× cost vs gpt-4o. Faster than gpt-4o-mini. Same JSON reliability. **Recommended for production.**

Or use gpt-4o-mini as a slightly more capable middle ground:
```
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o-mini
```
Saves 16× cost vs gpt-4o.

### 2. Route by task complexity
- **Viral signal detection** (needs reasoning) → gpt-4o-mini / deepseek-chat / gemini-2.0-flash
- **Hashtag generation** (pattern matching) → groq-small / mistral-small / llama-3.1-8b
- **Title optimization** (creative) → llama-3.3-70b / mistral-large
- **Metadata extraction** (structured) → gemini-1.5-flash / novita-8b

### 3. Cache repeated transcripts
Same YouTube video processed by multiple users → transcript + signals cached → skip 5 LLM calls.

### 4. Reduce clips from 5 to 3 for free tier
`max_clips=3` cuts per-clip content calls from 15 → 9. Saves 40% of total LLM cost.

---

## Scale Projections

| Videos/month | gpt-4o | gpt-4.1-nano ⭐ | gpt-4o-mini | groq-small | Together-8B | gemini-flash |
|-------------|--------|---------------|------------|------------|-------------|-------------|
| 100 | $27 | $1.10 | $1.70 | $0.30 | $0.10 | $0.80 |
| 1,000 | $270 | $11 | $17 | $3 | $1 | $8 |
| 5,000 | $1,350 | $55 | $85 | $15 | $5 | $40 |
| 10,000 | $2,700 | $110 | $170 | $30 | $10 | $80 |
| 50,000 | $13,500 | $550 | $850 | $150 | $50 | $400 |

**Recommended production stack:** `LLM_PROVIDER_PRIORITY=azure-openai` with `AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4.1-nano`. Free fallback chain (groq → openrouter-gemma) handles rate limit spikes at zero cost.
