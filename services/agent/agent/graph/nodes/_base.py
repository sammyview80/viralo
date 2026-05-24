import json
import os
import re
from typing import Any


async def broadcast(redis, session_id: str, agent: str, msg_type: str, content: str, extra: dict | None = None) -> None:
    msg = {"type": msg_type, "agent": agent, "content": content}
    if extra:
        msg.update(extra)
    payload = json.dumps(msg)
    await redis.rpush(f"session:{session_id}:msgs", payload)
    # Keep buffer at 500 messages
    await redis.ltrim(f"session:{session_id}:msgs", -500, -1)
    await redis.publish(f"session:{session_id}:live", payload)


def get_search_tool():
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return None
    try:
        from langchain_community.tools.tavily_search import TavilySearchResults
        return TavilySearchResults(max_results=5, api_key=api_key)
    except Exception:
        return None


def parse_json_block(text: str) -> Any:
    # Try to extract JSON from markdown code block first
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # Try raw JSON parse
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    # Try to find first { or [ and parse from there
    for start_char, end_char in [('{', '}'), ('[', ']')]:
        start = text.find(start_char)
        end = text.rfind(end_char)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
    return None
