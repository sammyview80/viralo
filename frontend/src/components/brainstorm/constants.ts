export const EXAMPLE_TOPICS = ["AI fitness coach", "Street food Nepal", "Solo travel tips", "Budget skincare"] as const;

export const AGENT_LABELS: Record<string, string> = {
  viral_search_agent: "Viral Search",
  trend_agent: "Trend",
  competitor_agent: "Competitor",
  monetization_agent: "Monetize",
  audience_agent: "Audience",
  content_agent: "Content",
  synthesizer: "Synthesizer",
};

export const AGENT_DESC: Record<string, string> = {
  viral_search_agent: "Finding live YouTube, TikTok, and web trend signals",
  trend_agent: "Researching trending formats & growth trajectory",
  competitor_agent: "Mapping top creators & content gaps",
  monetization_agent: "Analyzing revenue potential & brand fit",
  audience_agent: "Profiling target demographics & motivations",
  content_agent: "Generating viral video concepts",
  synthesizer: "Synthesizing final verdict & strategy",
};

export const AGENTS = ["viral_search_agent", "trend_agent", "competitor_agent", "monetization_agent", "audience_agent", "content_agent", "synthesizer"] as const;
