"""CLI wrapper: python -m agent.graph.nodes.viral_search_cli "AI tools" --platforms youtube tiktok"""
import argparse
import json
import logging
import sys

from agent.graph.nodes.viral_search import search_viral_trends


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    p = argparse.ArgumentParser(description="Search viral trending videos")
    p.add_argument("topic", help="e.g. 'AI tools 2025'")
    p.add_argument("--platforms", nargs="+", default=["youtube", "tiktok", "web"],
                   choices=["youtube", "tiktok", "web"])
    p.add_argument("--force-refresh", action="store_true", help="bypass cache")
    p.add_argument("--json", action="store_true", help="output raw JSON")
    args = p.parse_args()

    result = search_viral_trends(args.topic, platforms=args.platforms,
                                  force_refresh=args.force_refresh)

    if args.json:
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
        return

    print(f"\n=== Viral Trends: {args.topic} ===")
    print(f"Cache hit: {result.from_cache} | {result.platform_summary()}")
    print(f"\nTop by views:")
    for v in result.top_by_views(8):
        views = f"{v['views']:,}" if v.get("views") else "?"
        print(f"  [{v['platform'].upper():8}] {views:>12} views — {v['title'][:70]}")
        print(f"           {v['url']}")
    print(f"\nCommon hashtags: {' '.join('#' + h for h in result.common_hashtags(10))}")


if __name__ == "__main__":
    main()
