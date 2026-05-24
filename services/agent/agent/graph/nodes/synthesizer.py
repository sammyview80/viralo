from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig

from agent.graph.state import BrainstormState
from agent.graph.nodes._base import broadcast

PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a Synthesizer producing a final verdict on a content niche.
Based on all research provided, write a 2-3 paragraph niche verdict that covers:
1. Should the creator enter this niche? (clear recommendation)
2. Key opportunity and the biggest risk
3. The #1 differentiator that would make them stand out

Be direct, opinionated, and actionable. Write like a seasoned content strategist."""),
    ("human", """Topic: {topic}
Trend score: {trend_confidence}
Competitor opportunity score: {opportunity_score}
Monetization score: {monetization_score}
Top video ideas: {top_ideas}

Write the niche verdict."""),
])


async def synthesizer_fn(state: BrainstormState, config: RunnableConfig) -> dict:
    llm = config["configurable"]["llm"]
    redis = config["configurable"]["redis"]
    session_id = state["session_id"]
    topic = state["topic"]

    await broadcast(redis, session_id, "synthesizer", "agent_message",
                    "Synthesizing all research into final verdict...")

    trend_confidence = state.get("trend_data", {}).get("confidence_score", "N/A")
    opportunity_score = state.get("competitor_data", {}).get("opportunity_score", "N/A")
    monetization_score = state.get("monetization_data", {}).get("monetization_score", "N/A")
    top_ideas = str(state.get("video_ideas", [])[:3])[:600]

    verdict = ""
    async for chunk in (PROMPT | llm).astream({
        "topic": topic,
        "trend_confidence": trend_confidence,
        "opportunity_score": opportunity_score,
        "monetization_score": monetization_score,
        "top_ideas": top_ideas,
    }):
        content = getattr(chunk, "content", "") or ""
        if content:
            verdict += content
            await broadcast(redis, session_id, "synthesizer", "agent_message", content)

    await broadcast(redis, session_id, "synthesizer", "session_complete",
                    "Brainstorm session complete!", extra={"progress": 100})

    return {"niche_verdict": verdict}
