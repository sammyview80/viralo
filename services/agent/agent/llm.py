import os
from typing import Any

from langchain_core.language_models import BaseChatModel


def get_llm(llm_provider: str | None = None, llm_api_key_enc: str | None = None, llm_model: str | None = None) -> BaseChatModel:
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
            from langchain_groq import ChatGroq
            return ChatGroq(
                model="llama-3.3-70b-versatile",
                api_key=os.getenv("GROQ_API_KEY"),
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
