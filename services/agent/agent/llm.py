import logging
import os

from langchain_core.language_models import BaseChatModel

log = logging.getLogger(__name__)


def get_llm(llm_provider: str | None = None, llm_api_key_enc: str | None = None, llm_model: str | None = None) -> BaseChatModel:
    """
    Return a LangChain chat model.

    When called with explicit provider/key/model — honour it (user-configured agent).
    When called with no arguments — use the global free-tier fallback hierarchy:
      Groq → Cloudflare AI → Cerebras → OpenRouter → SambaNova → Groq-small
    """
    if not llm_provider and not llm_api_key_enc and not llm_model:
        return get_llm_with_fallback()

    provider = llm_provider or os.getenv("DEFAULT_LLM_PROVIDER", "groq")
    api_key = _decrypt_key(llm_api_key_enc) if llm_api_key_enc else None

    match provider:
        case "groq":
            from langchain_groq import ChatGroq
            return ChatGroq(
                model=llm_model or "llama-3.3-70b-versatile",
                api_key=api_key or os.getenv("GROQ_API_KEY"),
                streaming=True,
            )
        case "openai":
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model=llm_model or "gpt-4o",
                api_key=api_key or os.getenv("OPENAI_API_KEY"),
                streaming=True,
            )
        case "anthropic":
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(
                model=llm_model or "claude-3-5-sonnet-20241022",
                api_key=api_key or os.getenv("ANTHROPIC_API_KEY"),
                streaming=True,
            )
        case "google":
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(
                model=llm_model or "gemini-1.5-pro",
                google_api_key=api_key or os.getenv("GOOGLE_API_KEY"),
            )
        case _:
            return get_llm_with_fallback()


def get_llm_with_fallback() -> BaseChatModel:
    """
    Build a LangChain fallback chain across ALL configured free-tier providers.
    Uses .with_fallbacks() so that if the primary raises ANY exception (including
    RateLimitError / 429), LangChain automatically tries the next model in the chain.

    Hierarchy: Groq → Cloudflare AI → Cerebras → OpenRouter → SambaNova → Groq-small
    """
    from shared.llm import _get_providers, _resolve_provider, _probe

    models: list[BaseChatModel] = []

    for p in _get_providers():
        api_key, base_url = _resolve_provider(p)
        if not api_key:
            continue

        model = p["model_large"]
        if not _probe(api_key, base_url, model, p["json_mode"]):
            log.warning(f"[LLM-agent] {p['name']} probe failed — skipping")
            continue

        try:
            lc_model = _build_langchain_model(p["name"], api_key, base_url, model)
            if lc_model:
                log.info(f"[LLM-agent] Added to fallback chain: {p['name']} / {model}")
                models.append(lc_model)
        except Exception as e:
            log.warning(f"[LLM-agent] {p['name']} build failed: {e}")
            continue

    if not models:
        raise RuntimeError("All free LLM providers unavailable for agent. Check API keys and quotas.")

    if len(models) == 1:
        return models[0]

    # Primary + fallback chain — LangChain tries each in order on any exception
    primary = models[0]
    fallbacks = models[1:]
    log.info(f"[LLM-agent] Fallback chain: {len(models)} providers")
    return primary.with_fallbacks(fallbacks, exceptions_to_handle=(Exception,))


def _build_langchain_model(name: str, api_key: str, base_url: str, model: str) -> BaseChatModel | None:
    """Build a LangChain model for the given provider. All providers use ChatOpenAI-compatible interface."""
    if name in ("groq", "groq-small"):
        from langchain_groq import ChatGroq
        return ChatGroq(model=model, api_key=api_key, streaming=True)

    # Cerebras, OpenRouter, SambaNova, Cloudflare — all OpenAI-compatible
    from langchain_openai import ChatOpenAI
    return ChatOpenAI(
        model=model,
        api_key=api_key,
        base_url=base_url,
        streaming=True,
    )


def _decrypt_key(encrypted: str) -> str | None:
    encryption_key = os.getenv("ENCRYPTION_KEY", "")
    if not encryption_key or not encrypted:
        return None
    try:
        from cryptography.fernet import Fernet
        f = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)
        return f.decrypt(encrypted.encode()).decode()
    except Exception:
        return None
