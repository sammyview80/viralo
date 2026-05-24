from typing import Annotated, Any
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class BrainstormState(TypedDict):
    session_id: str
    tenant_id: str
    topic: str
    trend_data: dict[str, Any]
    competitor_data: dict[str, Any]
    monetization_data: dict[str, Any]
    audience_data: dict[str, Any]
    video_ideas: list[Any]
    niche_verdict: str
    messages: Annotated[list, add_messages]
