from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnableConfig

from agent.graph.state import BrainstormState
from agent.graph.nodes._base import broadcast, get_search_tool, parse_json_block

PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a Monetization Agent evaluating revenue potential for a content niche.
Analyze:
1. CPM rates for this niche (estimated range)
2. Brand deal potential and typical rates
3. Affiliate marketing opportunities
4. Digital product or course potential
5. Overall revenue ceiling for a mid-tier creator (100k subs equivalent)

Return JSON with keys:
estimated_cpm_range, brand_deal_potential (low/medium/high), top_affiliate_opportunities (list),
product_ideas (list), monthly_revenue_potential (low/mid/high estimates), monetization_score (0-100)
"""),
    ("human", "Topic: {topic}\nCompetitor context: {competitor_summary}"),
])


async def monetization_agent_fn(state: BrainstormState, config: RunnableConfig) -> dict:
    llm = config["configurable"]["llm"]
    redis = config["configurable"]["redis"]
    session_id = state["session_id"]
    topic = state["topic"]
    competitor_summary = str(state.get("competitor_data", {}))[:500]

    await broadcast(redis, session_id, "monetization_agent", "agent_message",
                    f"Evaluating monetization potential for {topic}...")

    search = get_search_tool()
    chain = PROMPT | llm.bind_tools([search]) if search else PROMPT | llm

    full_text = ""
    async for chunk in chain.astream({"topic": topic, "competitor_summary": competitor_summary}):
        content = getattr(chunk, "content", "") or ""
        if content:
            full_text += content
            await broadcast(redis, session_id, "monetization_agent", "agent_message", content)

    monetization_data = parse_json_block(full_text) or {"raw": full_text}

    await broadcast(redis, session_id, "monetization_agent", "agent_change",
                    "Monetization analysis complete", extra={"next": "audience_agent", "progress": 60})

    return {"monetization_data": monetization_data}
