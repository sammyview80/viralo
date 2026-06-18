import os
from langgraph.graph import StateGraph, END

from agent.graph.state import BrainstormState
from agent.graph.nodes.viral_search import viral_search_agent_fn
from agent.graph.nodes.trend import trend_agent_fn
from agent.graph.nodes.competitor import competitor_agent_fn
from agent.graph.nodes.monetization import monetization_agent_fn
from agent.graph.nodes.audience import audience_agent_fn
from agent.graph.nodes.content import content_agent_fn
from agent.graph.nodes.synthesizer import synthesizer_fn


def build_graph() -> StateGraph:
    graph = StateGraph(BrainstormState)

    graph.add_node("viral_search_agent", viral_search_agent_fn)
    graph.add_node("trend_agent", trend_agent_fn)
    graph.add_node("competitor_agent", competitor_agent_fn)
    graph.add_node("monetization_agent", monetization_agent_fn)
    graph.add_node("audience_agent", audience_agent_fn)
    graph.add_node("content_agent", content_agent_fn)
    graph.add_node("synthesizer", synthesizer_fn)

    graph.set_entry_point("viral_search_agent")
    graph.add_edge("viral_search_agent", "trend_agent")
    graph.add_edge("trend_agent", "competitor_agent")
    graph.add_edge("competitor_agent", "monetization_agent")
    graph.add_edge("monetization_agent", "audience_agent")
    graph.add_edge("audience_agent", "content_agent")
    graph.add_edge("content_agent", "synthesizer")
    graph.add_edge("synthesizer", END)

    return graph


def get_compiled_graph(checkpointer=None):
    graph = build_graph()
    return graph.compile(checkpointer=checkpointer)
