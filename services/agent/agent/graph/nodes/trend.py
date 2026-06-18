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
    ("human", "Analyze trends for this topic: {topic}\n\nFresh viral search data: {viral_search_summary}"),
])


async def trend_agent_fn(state: BrainstormState, config: RunnableConfig) -> dict:
    llm = config["configurable"]["llm"]
    redis = config["configurable"]["redis"]
    session_id = state["session_id"]
    topic = state["topic"]
    viral_search_summary = str(state.get("trend_data", {}))[:1500]

    await broadcast(redis, session_id, "trend_agent", "agent_message",
                    f"Analyzing trends for: {topic}...")

    search = get_search_tool()
    chain = PROMPT | llm.bind_tools([search]) if search else PROMPT | llm

    full_text = ""
    async for chunk in chain.astream({"topic": topic, "viral_search_summary": viral_search_summary}):
        content = getattr(chunk, "content", "") or ""
        if content:
            full_text += content
            await broadcast(redis, session_id, "trend_agent", "agent_message", content)

    llm_trend_data = parse_json_block(full_text) or {"raw": full_text}
    prior_trend_data = state.get("trend_data", {})
    trend_data = {
        **prior_trend_data,
        "llm_analysis": llm_trend_data,
    }
    if isinstance(llm_trend_data, dict):
        trend_data.update({k: v for k, v in llm_trend_data.items() if k not in trend_data})

    await broadcast(redis, session_id, "trend_agent", "agent_change",
                    "Trend analysis complete", extra={"next": "competitor_agent", "progress": 28})

    return {"trend_data": trend_data}
