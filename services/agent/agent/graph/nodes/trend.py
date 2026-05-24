import json
import os
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig

from agent.graph.state import BrainstormState
from agent.graph.nodes._base import broadcast, get_search_tool, parse_json_block

PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a Trend Agent analyzing content trends for a given niche/topic.
Research and identify:
1. Current trending video formats and styles
2. Growth trajectory (rising, stable, saturated)
3. Top performing content themes
4. Seasonal patterns
5. Platform-specific trends (TikTok vs YouTube vs Reels)

Use the search tool to find real data. Return a JSON object with keys:
trending_formats, growth_stage, top_themes, seasonal_notes, platform_notes, confidence_score (0-100)
"""),
    ("human", "Analyze trends for this topic: {topic}"),
])


async def trend_agent_fn(state: BrainstormState, config: RunnableConfig) -> dict:
    llm = config["configurable"]["llm"]
    redis = config["configurable"]["redis"]
    session_id = state["session_id"]
    topic = state["topic"]

    await broadcast(redis, session_id, "trend_agent", "agent_message",
                    f"Analyzing trends for: {topic}...")

    search = get_search_tool()
    chain = PROMPT | llm.bind_tools([search]) if search else PROMPT | llm

    full_text = ""
    async for chunk in chain.astream({"topic": topic}):
        content = getattr(chunk, "content", "") or ""
        if content:
            full_text += content
            await broadcast(redis, session_id, "trend_agent", "agent_message", content)

    trend_data = parse_json_block(full_text) or {"raw": full_text}

    await broadcast(redis, session_id, "trend_agent", "agent_change",
                    "Trend analysis complete", extra={"next": "competitor_agent", "progress": 20})

    return {"trend_data": trend_data}
