from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig

from agent.graph.state import BrainstormState
from agent.graph.nodes._base import broadcast, get_search_tool, parse_json_block

PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a Competitor Agent analyzing top creators in a niche.
Research and identify:
1. Top 5-10 creators in this space and their subscriber counts
2. Their most successful content types and formats
3. Content gaps — topics they're NOT covering well
4. Their posting frequency and consistency
5. Engagement rates and what drives their growth

Use search to find real data. Return JSON with keys:
top_creators (list), content_gaps (list), avg_posting_frequency, engagement_insights, opportunity_score (0-100)
"""),
    ("human", "Topic: {topic}\nTrend context: {trend_summary}"),
])


async def competitor_agent_fn(state: BrainstormState, config: RunnableConfig) -> dict:
    llm = config["configurable"]["llm"]
    redis = config["configurable"]["redis"]
    session_id = state["session_id"]
    topic = state["topic"]
    trend_summary = str(state.get("trend_data", {}))[:500]

    await broadcast(redis, session_id, "competitor_agent", "agent_message",
                    f"Analyzing competitors in the {topic} space...")

    search = get_search_tool()
    chain = PROMPT | llm.bind_tools([search]) if search else PROMPT | llm

    full_text = ""
    async for chunk in chain.astream({"topic": topic, "trend_summary": trend_summary}):
        content = getattr(chunk, "content", "") or ""
        if content:
            full_text += content
            await broadcast(redis, session_id, "competitor_agent", "agent_message", content)

    competitor_data = parse_json_block(full_text) or {"raw": full_text}

    await broadcast(redis, session_id, "competitor_agent", "agent_change",
                    "Competitor analysis complete", extra={"next": "monetization_agent", "progress": 44})

    return {"competitor_data": competitor_data}
