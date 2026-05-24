from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig

from agent.graph.state import BrainstormState
from agent.graph.nodes._base import broadcast, parse_json_block

PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a Content Strategy Agent generating viral video ideas.
Using all research gathered, create:
1. Exactly 10 specific, actionable video ideas with viral potential
2. For each idea: title, hook (first 3 seconds script), format, estimated virality score

Each idea should be concrete — not "tips for X" but "I tried X for 30 days and here's what happened"

Return JSON array with 10 objects, each having:
title, hook, format (talking_head/vlog/tutorial/challenge/reaction/etc),
estimated_views_potential (low/medium/high/viral), virality_score (0-100), reasoning
"""),
    ("human", """Topic: {topic}
Trends: {trend_summary}
Gaps: {gaps_summary}
Audience: {audience_summary}

Generate 10 viral video ideas."""),
])


async def content_agent_fn(state: BrainstormState, config: RunnableConfig) -> dict:
    llm = config["configurable"]["llm"]
    redis = config["configurable"]["redis"]
    session_id = state["session_id"]
    topic = state["topic"]

    trend_summary = str(state.get("trend_data", {}))[:400]
    gaps_summary = str(state.get("competitor_data", {}).get("content_gaps", []))[:300]
    audience_summary = str(state.get("audience_data", {}))[:400]

    await broadcast(redis, session_id, "content_agent", "agent_message",
                    f"Generating viral video ideas for {topic}...")

    full_text = ""
    async for chunk in (PROMPT | llm).astream({
        "topic": topic,
        "trend_summary": trend_summary,
        "gaps_summary": gaps_summary,
        "audience_summary": audience_summary,
    }):
        content = getattr(chunk, "content", "") or ""
        if content:
            full_text += content
            await broadcast(redis, session_id, "content_agent", "agent_message", content)

    video_ideas = parse_json_block(full_text)
    if not isinstance(video_ideas, list):
        video_ideas = [{"raw": full_text}]

    await broadcast(redis, session_id, "content_agent", "agent_change",
                    "Content strategy complete", extra={"next": "synthesizer", "progress": 90})

    return {"video_ideas": video_ideas}
