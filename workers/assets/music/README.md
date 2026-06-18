# Music Assets

Place CC0 / royalty-free background music tracks here. Required filenames are included as generated synthetic tone beds in this directory; replace them with better CC0 / royalty-free tracks before production if desired.

| File | Use | Source ideas |
|------|-----|--------------|
| `hype.mp3` | Sports/gaming hype — fast, energetic | freemusicarchive.org, pixabay.com/music |
| `dramatic.mp3` | Tense/cinematic — slow build | freemusicarchive.org |
| `chill.mp3` | Podcast/talking-head — ambient lo-fi | lofi.co, pixabay.com/music |

**License requirement:** Must be CC0 (no attribution required) or CC BY (attribution in
video description). Do NOT use CC-ND, CC-SA, or any rights-reserved track — platforms
will copyright-strike the clips. Verify license at source before adding.

Tracks are baked into the worker Docker image. Add them here, then rebuild:
```
docker compose build celery-video-pipeline
```
