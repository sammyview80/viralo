from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig

from agent.graph.state import BrainstormState
from agent.graph.nodes._base import broadcast, get_search_tool, parse_json_block

PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are an Audience Agent profiling the ideal viewer for a content niche.
Identify:
1. Primary demographic (age range, gender split, location)
2. Core pain points and desires
3. Why they watch — entertainment, education, inspiration, community
4. What makes them subscribe vs just watch
5. Best times to post, ideal video length, preferred format

Return JSON with keys:
demographics, primary_motivations (list), pain_points (list), subscribe_triggers (list),
optimal_posting_times, ideal_video_length_seconds, preferred_format, audience_score (0-100)
"""),
    ("human", "Topic: {topic}\nTrend data: {trend_summary}\nCompetitor data: {competitor_summary}"),
])


async def audience_agent_fn(state: BrainstormState, config: RunnableConfig) -> dict:
    llm = config["configurable"]["llm"]
    redis = config["configurable"]["redis"]
    session_id = state["session_id"]
    topic = state["topic"]
    trend_summary = str(state.get("trend_data", {}))[:300]
    competitor_summary = str(state.get("competitor_data", {}))[:300]

    await broadcast(redis, session_id, "audience_agent", "agent_message",
                    f"Profiling the audience for {topic} content...")

    search = get_search_tool()
    chain = PROMPT | llm.bind_tools([search]) if search else PROMPT | llm

    full_text = ""
    async for chunk in chain.astream({
        "topic": topic,
        "trend_summary": trend_summary,
        "competitor_summary": competitor_summary,
    }):
        content = getattr(chunk, "content", "") or ""
        if content:
            full_text += content
            await broadcast(redis, session_id, "audience_agent", "agent_message", content)

    audience_data = parse_json_block(full_text) or {"raw": full_text}

    await broadcast(redis, session_id, "audience_agent", "agent_change",
                    "Audience analysis complete", extra={"next": "content_agent", "progress": 80})

    return {"audience_data": audience_data}
