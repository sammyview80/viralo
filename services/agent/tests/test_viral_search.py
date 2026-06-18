import sys
import os
from unittest.mock import MagicMock, patch
from pathlib import Path

# Add services/agent to path
agent_path = os.path.join(os.getcwd(), "services/agent")
if agent_path not in sys.path:
    sys.path.append(agent_path)

from agent.graph.nodes.viral_search import search_viral_trends

def test_viral_search_logic():
    print("Running viral search logic tests...")
    
    # Mocking the platform fetchers in _viral_search_sources
    with patch("agent.graph.nodes.viral_search.youtube_search") as mock_yt, \
         patch("agent.graph.nodes.viral_search.tiktok_trending") as mock_tt, \
         patch("agent.graph.nodes.viral_search.tavily_search") as mock_tavily:
        
        mock_yt.return_value = [{"platform": "youtube", "title": "YT Video", "url": "https://yt.com/1", "views": 1000}]
        mock_tt.return_value = [{"platform": "tiktok", "title": "TT Video", "url": "https://tt.com/1", "views": 2000}]
        mock_tavily.return_value = [{"platform": "web", "title": "Web Video", "url": "https://web.com/1", "views": 500}]
        
        # Test cache miss (force-refresh)
        # We need to ensure _cache_read is mocked to return None
        with patch("agent.graph.nodes.viral_search._cache_read", return_value=None), \
             patch("agent.graph.nodes.viral_search._cache_write") as mock_write:
            
            result = search_viral_trends("test topic")
            
            assert len(result.youtube) == 1
            assert len(result.tiktok) == 1
            assert len(result.web) == 1
            assert result.from_cache is False
            assert mock_yt.called
            assert mock_tt.called
            assert mock_write.called
            print("  ✓ Cache miss / live fetch passed")
            
        # Test cache hit
        cached_data = {
            "videos_youtube": [{"platform": "youtube", "title": "Cached YT", "url": "https://yt.com/cached"}],
            "videos_tiktok": [],
            "videos_web": []
        }
        with patch("agent.graph.nodes.viral_search._cache_read", return_value=cached_data):
            result = search_viral_trends("test topic")
            
            assert len(result.youtube) == 1
            assert result.youtube[0]["title"] == "Cached YT"
            assert result.from_cache is True
            print("  ✓ Cache hit passed")

def test_result_aggregation():
    from agent.graph.nodes.viral_search import TrendSearchResult
    
    yt = [{"views": 10, "hashtags": ["a", "b"]}, {"views": 20, "hashtags": ["b", "c"]}]
    tt = [{"views": 30, "hashtags": ["c", "d"]}]
    web = []
    
    res = TrendSearchResult("topic", yt, tt, web, False)
    summary = res.platform_summary()
    
    assert summary["youtube_count"] == 2
    assert summary["tiktok_count"] == 1
    assert summary["total"] == 3
    assert "c" in res.common_hashtags()
    print("  ✓ Result aggregation/summary passed")

async def test_viral_search_node():
    from agent.graph.nodes.viral_search import viral_search_agent_fn
    
    state = {"topic": "AI video tools", "session_id": "test_session"}
    config = {"configurable": {"redis": MagicMock()}}
    
    with patch("agent.graph.nodes.viral_search.search_viral_trends") as mock_search, \
         patch("agent.graph.nodes._base.broadcast") as mock_broadcast:
        
        mock_res = MagicMock()
        mock_res.platform_summary.return_value = {"total": 0, "youtube_count": 0, "tiktok_count": 0, "web_count": 0}
        mock_res.from_cache = False
        mock_res.top_by_views.return_value = []
        mock_res.common_hashtags.return_value = []
        mock_res.youtube = []
        mock_res.tiktok = []
        mock_search.return_value = mock_res
        
        output = await viral_search_agent_fn(state, config)
        
        assert "trend_data" in output
        assert output["trend_data"]["topic"] == "AI video tools"
        assert mock_search.called
        assert mock_broadcast.called
        print("  ✓ viral_search_agent_fn passed")

if __name__ == "__main__":
    import asyncio
    
    async def run_all():
        try:
            test_viral_search_logic()
            test_result_aggregation()
            await test_viral_search_node()
            print("\nAll viral search tests passed!")
        except AssertionError as e:
            print(f"\nAssertion failed!")
            sys.exit(1)
        except Exception as e:
            print(f"\nAn error occurred: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)
            
    asyncio.run(run_all())
