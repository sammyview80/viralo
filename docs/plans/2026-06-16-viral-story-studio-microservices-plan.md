# Viral Story Studio Microservices Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build Viralo Story Studio as isolated microservices and separate frontend tabs so the AI story/video pipeline can scale independently in separate Docker containers.

**Architecture:** Add a new bounded domain for AI story generation instead of expanding the existing video clipping flow. Use separate FastAPI services for story orchestration, media generation, and rendering, plus dedicated Celery workers/queues for long-running jobs. The frontend exposes Story Studio as tabs: Templates, Ideas, Episode, Characters, Scenes, Generation, and Jobs.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, PostgreSQL, Redis, RabbitMQ/Celery, Docker Compose, React/Vite/Tailwind, Gemini API for current video generation, FFmpeg for final assembly later.

---

## Non-Negotiable Product Decisions

1. The feature must be separate from the current upload/clip generator.
2. Each backend module must be runnable in a separate container.
3. Long-running AI/video work must run through Celery queues, not HTTP request blocking.
4. Gemini API is the default video generation provider for now.
5. Scene image/video/caption/render steps should be resumable from intermediate assets.
6. The frontend must use separate tabs, not one huge form.
7. MVP should support storyboard + Gemini video generation first; advanced providers can be added later behind adapters.

## Target Microservices

### 1. story-service

Purpose:
Owns templates, ideas, episodes, characters, scenes, and orchestration state.

Container:
`story-service`

Port:
`8010`

Code path:
`services/story/`

Responsibilities:
- CRUD series templates
- Generate 6 scenario ideas
- Generate episode JSON
- Store characters with Name, Role, Personality, Voice
- Store scenes with Setting, Action, Characters, Dialogue
- Submit generation jobs to media/render services through Celery
- Expose job status to frontend

Suggested API prefix:
`/api/v1/story`

### 2. media-service

Purpose:
Owns AI provider integrations for images, Gemini video generation, TTS, and optional alignment.

Container:
`media-service`

Port:
`8011`

Code path:
`services/media/`

Responsibilities:
- Generate character reference images
- Generate scene images
- Generate image-to-video clips through Gemini API for now
- Generate TTS audio later
- Save generated assets to local storage/S3/R2
- Return provider result metadata and asset URLs

Suggested API prefix:
`/api/v1/media`

Provider adapters:
- `services/media/media/providers/gemini_video.py`
- `services/media/media/providers/image_provider.py`
- `services/media/media/providers/tts_provider.py`

For now:
- Gemini is required for video generation.
- Image provider can start as placeholder/mock or Gemini/image API if configured.
- TTS can be deferred until video generation works.

### 3. render-service

Purpose:
Owns deterministic post-processing: captions, audio mix, clip concat, final MP4 assembly.

Container:
`render-service`

Port:
`8012`

Code path:
`services/render/`

Responsibilities:
- Caption overlay rendering
- FFmpeg scene composition
- Final video stitching
- Optional background music mix
- Loudness normalization
- Export final 9:16 MP4

MVP status:
Can start with health endpoint + stubbed render job. Implement real FFmpeg stitching after Gemini per-scene clips are saved.

### 4. Dedicated Celery workers

Add separate workers so one workload cannot block another.

Workers:
- `celery-story`: ideas + episode JSON generation
- `celery-media-image`: character and scene image generation
- `celery-media-video`: Gemini video generation
- `celery-media-audio`: future TTS/alignment
- `celery-render`: caption/render/stitching

Queues:
- `viralo.story.generate`
- `viralo.media.image`
- `viralo.media.video`
- `viralo.media.audio`
- `viralo.render.compose`

## High-Level Runtime Flow

1. Frontend opens `/story-studio`.
2. User selects a series template in Templates tab.
3. Frontend calls story-service to generate scenario ideas.
4. User selects or customizes an idea in Ideas tab.
5. story-service generates episode JSON: characters + scenes.
6. User edits episode in Episode/Characters/Scenes tabs.
7. User clicks Generate.
8. story-service creates generation jobs.
9. media-service generates character references.
10. media-service generates scene images.
11. media-service sends scene image + motion prompt to Gemini API for video generation.
12. render-service later stitches generated scene clips into final video.
13. Jobs tab shows live statuses and retry buttons.

## Frontend Tab Structure

Create one new page:
`frontend/src/workspace/pages/StoryStudioPage.tsx`

Tabs inside the page:

1. Templates
   - Grid of series templates
   - Selected template preview
   - CTA: Generate Ideas

2. Ideas
   - 6 AI-generated idea cards
   - Regenerate button
   - Custom premise mode
   - Settings: scene count, scene length, language, aspect ratio

3. Episode
   - Episode title/premise
   - Summary panel
   - Regenerate episode button

4. Characters
   - Character cards
   - Edit modal with exactly: Name, Role, Personality, Voice
   - Generate Character Images button
   - Status: 0/5 ready

5. Scenes
   - Expandable scene cards
   - Fields: title, duration, setting, action, active characters, dialogue
   - Generate Scene Images button

6. Generation
   - Video model selector: Gemini default
   - Aspect ratio locked/defaulted to 9:16
   - Estimated token/cost panel
   - Create AI Video Story button

7. Jobs
   - Job timeline
   - Per-step status
   - Retry failed step
   - Links to generated assets

UX rules:
- Keep density compact.
- Use progressive disclosure for long prompts and dialogue.
- Primary action must always be visible on each tab.
- Do not show all generated prompts by default; hide them under dropdowns.

## Database Model Plan

Create new tables rather than overloading existing `videos` and `clips` tables.

Tables:
- `story_series_templates`
- `story_ideas`
- `story_episodes`
- `story_characters`
- `story_scenes`
- `story_generation_jobs`
- `story_assets`

### story_series_templates

Fields:
- id UUID PK
- tenant_id UUID nullable if global template
- title String(255)
- description Text
- genre String(120)
- character_archetype Text
- visual_style Text
- dramatic_formula Text
- role_schema JSONB
- cover_image_url Text nullable
- sample_video_url Text nullable
- is_global Boolean default false
- created_at / updated_at

### story_episodes

Fields:
- id UUID PK
- tenant_id UUID not null
- user_id UUID not null
- template_id UUID FK
- title String(255)
- premise Text
- scene_count SmallInteger
- scene_length_seconds SmallInteger
- aspect_ratio String(10) default `9:16`
- language String(20) default `en`
- status String(50)
- provider_config JSONB
- final_video_url Text nullable
- error_message Text nullable
- created_at / updated_at

### story_characters

Fields:
- id UUID PK
- tenant_id UUID not null
- episode_id UUID FK
- name String(120)
- role String(120)
- personality Text
- voice Text nullable
- appearance_lock Text nullable internal only
- reference_image_url Text nullable
- reference_image_status String(30) default `pending`
- sort_order SmallInteger
- created_at / updated_at

### story_scenes

Fields:
- id UUID PK
- tenant_id UUID not null
- episode_id UUID FK
- scene_number SmallInteger
- title String(255)
- duration_seconds SmallInteger
- setting Text
- action Text
- character_ids JSONB
- dialogue_json JSONB
- image_prompt Text nullable
- video_prompt Text nullable
- caption Text nullable
- image_url Text nullable
- video_url Text nullable
- status String(50) default `draft`
- created_at / updated_at

### story_generation_jobs

Fields:
- id UUID PK
- tenant_id UUID not null
- episode_id UUID FK
- scene_id UUID nullable
- character_id UUID nullable
- job_type String(60)
- status String(30)
- provider String(60)
- celery_task_id String(80) nullable
- input_json JSONB
- result_json JSONB
- error_message Text nullable
- cost_tokens Numeric nullable
- created_at / updated_at

### story_assets

Fields:
- id UUID PK
- tenant_id UUID not null
- episode_id UUID FK
- scene_id UUID nullable
- character_id UUID nullable
- asset_type String(40)
- storage_url Text
- storage_key Text nullable
- provider String(60)
- metadata JSONB
- created_at / updated_at

## Gemini Video Generation Adapter

Create:
`services/media/media/providers/gemini_video.py`

Interface:

```python
class GeminiVideoProvider:
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model

    async def generate_scene_video(
        self,
        *,
        scene_image_url: str,
        motion_prompt: str,
        duration_seconds: int,
        aspect_ratio: str = "9:16",
    ) -> dict:
        """Return {provider_job_id, video_url, raw_response}."""
```

Environment variables:
- `GEMINI_API_KEY`
- `GEMINI_VIDEO_MODEL`
- `MEDIA_STORAGE_DIR`
- `MEDIA_PUBLIC_BASE_URL`

Important:
- Keep Gemini-specific code behind this adapter.
- story-service should not know Gemini request details.
- If Gemini returns async operation IDs, store them in `story_generation_jobs.result_json` and poll via Celery.
- If Gemini returns bytes/file output, media-service stores it and returns a Viralo storage URL.

## API Endpoints

### story-service

`GET /api/v1/story/templates`
Return available templates.

`POST /api/v1/story/ideas/generate`
Input: template_id, language, optional custom seed.
Output: six ideas.

`POST /api/v1/story/episodes`
Create draft episode from selected idea.

`GET /api/v1/story/episodes/{episode_id}`
Return episode with characters, scenes, jobs, assets.

`PATCH /api/v1/story/episodes/{episode_id}`
Update title, premise, settings.

`PATCH /api/v1/story/characters/{character_id}`
Update Name, Role, Personality, Voice.

`PATCH /api/v1/story/scenes/{scene_id}`
Update setting, action, characters, dialogue.

`POST /api/v1/story/episodes/{episode_id}/generate-character-images`
Queue character image jobs.

`POST /api/v1/story/episodes/{episode_id}/generate-scene-images`
Queue scene image jobs.

`POST /api/v1/story/episodes/{episode_id}/generate-videos`
Queue Gemini video jobs.

`GET /api/v1/story/episodes/{episode_id}/jobs`
Return current job statuses.

`POST /api/v1/story/jobs/{job_id}/retry`
Retry failed job.

### media-service

Internal/admin endpoints only at first:

`POST /api/v1/media/character-image`
Generate one character reference image.

`POST /api/v1/media/scene-image`
Generate one scene image.

`POST /api/v1/media/scene-video/gemini`
Generate one scene video using Gemini.

`GET /api/v1/media/jobs/{provider_job_id}`
Poll provider status if needed.

### render-service

`POST /api/v1/render/episodes/{episode_id}/stitch`
Start final render.

`GET /api/v1/render/jobs/{job_id}`
Check render job.

## Docker Compose Plan

Modify:
- `docker-compose.yml`
- `docker-compose.dev.yml`

Add services:
- `story-service`
- `media-service`
- `render-service`
- `celery-story`
- `celery-media-image`
- `celery-media-video`
- `celery-media-audio`
- `celery-render`

Add volume:
- `story-media-storage:/tmp/viralo-story-media`

Add nginx routing:
- `/api/v1/story/` -> story-service:8010
- `/api/v1/media/` -> media-service:8011 if public/internal needed
- `/api/v1/render/` -> render-service:8012 if public/internal needed
- `/story-studio` handled by frontend SPA fallback

Suggested compose service block shape:

```yaml
story-service:
  <<: *service-defaults
  build:
    context: .
    dockerfile: services/story/Dockerfile
  ports:
    - "8010:8010"
  depends_on:
    migrate:
      condition: service_completed_successfully
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy
  healthcheck:
    <<: *healthcheck-defaults
    test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8010/health')\""]

media-service:
  <<: *service-defaults
  build:
    context: .
    dockerfile: services/media/Dockerfile
  ports:
    - "8011:8011"
  environment:
    GEMINI_API_KEY: ${GEMINI_API_KEY:-}
    GEMINI_VIDEO_MODEL: ${GEMINI_VIDEO_MODEL:-}
    MEDIA_STORAGE_DIR: /tmp/viralo-story-media
  volumes:
    - story-media-storage:/tmp/viralo-story-media
  depends_on:
    rabbitmq:
      condition: service_healthy
    redis:
      condition: service_healthy
  healthcheck:
    <<: *healthcheck-defaults
    test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8011/health')\""]

render-service:
  <<: *service-defaults
  build:
    context: .
    dockerfile: services/render/Dockerfile
  ports:
    - "8012:8012"
  volumes:
    - story-media-storage:/tmp/viralo-story-media
  depends_on:
    redis:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy
  healthcheck:
    <<: *healthcheck-defaults
    test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8012/health')\""]
```

## Implementation Tasks

### Task 1: Create service skeletons

Objective:
Add empty runnable FastAPI services for story, media, and render.

Files:
- Create: `services/story/Dockerfile`
- Create: `services/story/requirements.txt` if this repo requires per-service deps
- Create: `services/story/story/main.py`
- Create: `services/story/story/__init__.py`
- Create: `services/media/Dockerfile`
- Create: `services/media/media/main.py`
- Create: `services/media/media/__init__.py`
- Create: `services/render/Dockerfile`
- Create: `services/render/render/main.py`
- Create: `services/render/render/__init__.py`

Implementation:
Each service exposes `/health` returning service name and ok status.

Verification:
Run:
`docker compose config --quiet`

Expected:
No compose validation errors after services are added in later task.

### Task 2: Add Docker Compose services

Objective:
Run each new service in its own container.

Files:
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`

Implementation:
Add story-service, media-service, render-service and hot-reload dev volume mounts.

Verification:
Run:
`docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet`

Expected:
No output and exit code 0.

### Task 3: Add story database models and migration

Objective:
Create dedicated tables for story templates, episodes, characters, scenes, jobs, and assets.

Files:
- Create: `services/story/story/models.py`
- Create: `services/story/story/schemas.py`
- Create: `migrations/versions/<timestamp>_story_studio_tables.py`

Verification:
Run:
`docker compose run --rm migrate alembic upgrade head`

Expected:
Migration succeeds and tables exist.

### Task 4: Seed initial story templates

Objective:
Provide the first five templates.

Files:
- Create: `services/story/story/templates_seed.py`
- Modify: migration or startup seed path only if project already has seed pattern

Templates:
- Brand Identity Surgery
- Cheating Objects
- Poor vs Rich Transformation
- Forbidden Love
- School Bully Makeover

Verification:
Call:
`GET /api/v1/story/templates`

Expected:
Returns five templates.

### Task 5: Implement story-service API

Objective:
Expose templates, ideas, episode generation, update, and job status endpoints.

Files:
- Create: `services/story/story/routers/templates.py`
- Create: `services/story/story/routers/ideas.py`
- Create: `services/story/story/routers/episodes.py`
- Create: `services/story/story/routers/jobs.py`
- Modify: `services/story/story/main.py`

Verification:
Run service tests and manually call endpoints with curl.

### Task 6: Add LLM prompts for ideas and episodes

Objective:
Generate structured JSON for six ideas and full episode data.

Files:
- Create: `services/story/story/prompts.py`
- Create: `services/story/story/generation.py`
- Test: `services/story/tests/test_prompts.py`

Important:
Episode generation must output characters with only creator-facing fields:
- name
- role
- personality
- voice

Verification:
Run:
`pytest services/story/tests/test_prompts.py -v`

Expected:
Prompt builders include required schema fields.

### Task 7: Add Celery routes and story tasks

Objective:
Queue long-running story generation jobs.

Files:
- Modify: `workers/celery_app.py`
- Create: `workers/tasks/story.py`

Routes:
- `workers.tasks.story.generate_ideas` -> `viralo.story.generate`
- `workers.tasks.story.generate_episode` -> `viralo.story.generate`
- `workers.tasks.story.generate_character_images` -> `viralo.media.image`
- `workers.tasks.story.generate_scene_images` -> `viralo.media.image`
- `workers.tasks.story.generate_scene_videos` -> `viralo.media.video`

Verification:
Run:
`celery -A workers.celery_app inspect registered`

Expected:
Story tasks are registered.

### Task 8: Implement media-service Gemini adapter

Objective:
Generate scene videos using Gemini API behind an adapter.

Files:
- Create: `services/media/media/providers/gemini_video.py`
- Create: `services/media/media/schemas.py`
- Create: `services/media/media/routers/video.py`
- Modify: `services/media/media/main.py`
- Test: `services/media/tests/test_gemini_video_provider.py`

Verification:
Run unit tests with Gemini client mocked.

Expected:
Adapter receives scene image URL, motion prompt, duration, and aspect ratio and returns normalized result JSON.

### Task 9: Implement media image endpoints

Objective:
Support character reference images and scene images.

Files:
- Create: `services/media/media/routers/images.py`
- Create: `services/media/media/providers/image_provider.py`

MVP options:
- If image provider key exists, generate real images.
- Else provide deterministic placeholder asset generation so frontend/job flow works.

Verification:
Generate one character image job and one scene image job.

Expected:
Both produce an asset URL and update job status.

### Task 10: Implement render-service stub and later FFmpeg stitching

Objective:
Have a separate container ready for render operations.

Files:
- Create: `services/render/render/routers/render.py`
- Create: `services/render/render/ffmpeg.py`
- Create: `workers/tasks/render.py`

MVP:
- Stub stitch endpoint returns queued/succeeded with existing scene video URLs.

Next:
- Real FFmpeg concat and caption overlay.

Verification:
Run render service health check.

### Task 11: Add frontend route and nav item

Objective:
Expose Story Studio as its own page.

Files:
- Modify: `frontend/src/components/workspace-pages.tsx`
- Modify: `frontend/src/workspace/data.ts`
- Modify: `frontend/src/workspace/types.ts`
- Create: `frontend/src/workspace/pages/StoryStudioPage.tsx`

Route:
`/story-studio`

Nav label:
`Story Studio`

Verification:
Run:
`cd frontend && npm run build`

Expected:
Build succeeds and `/story-studio` renders.

### Task 12: Build frontend tab shell

Objective:
Add separate tabs before implementing all API calls.

Files:
- Modify: `frontend/src/workspace/pages/StoryStudioPage.tsx`

Tabs:
- Templates
- Ideas
- Episode
- Characters
- Scenes
- Generation
- Jobs

Verification:
Click each tab.

Expected:
Only active tab content is visible and state is preserved.

### Task 13: Add frontend API client

Objective:
Centralize story-service API calls.

Files:
- Modify or create: `frontend/src/lib/api.ts`
- Optional create: `frontend/src/lib/storyApi.ts`

Client methods:
- listTemplates
- generateIdeas
- createEpisode
- getEpisode
- updateCharacter
- updateScene
- generateCharacterImages
- generateSceneImages
- generateVideos
- listJobs
- retryJob

Verification:
Use mocked/stubbed responses or local service calls.

### Task 14: Wire Templates and Ideas tabs

Objective:
Make template selection and idea generation functional.

Files:
- Modify: `frontend/src/workspace/pages/StoryStudioPage.tsx`

Verification:
Select template, click Generate Ideas.

Expected:
Ideas tab shows six premise cards.

### Task 15: Wire Episode, Characters, and Scenes tabs

Objective:
Allow editing generated episode data.

Files:
- Modify: `frontend/src/workspace/pages/StoryStudioPage.tsx`

Character modal fields:
- Name
- Role
- Personality
- Voice

Scene card fields:
- title
- setting
- action
- active character chips
- dialogue

Verification:
Edit a character and scene, refresh episode.

Expected:
Saved values persist.

### Task 16: Wire Generation and Jobs tabs

Objective:
Start generation pipeline and show progress.

Files:
- Modify: `frontend/src/workspace/pages/StoryStudioPage.tsx`

Generation actions:
- Generate Character Images
- Generate Scene Images
- Generate Gemini Scene Videos
- Stitch Final Video later

Verification:
Trigger a Gemini video job with mocked provider.

Expected:
Job appears in Jobs tab and updates status.

### Task 17: Add nginx routes

Objective:
Make new services reachable through existing reverse proxy.

Files:
- Modify: `nginx/conf.d/*` appropriate config file

Routes:
- `/api/v1/story/`
- `/api/v1/media/`
- `/api/v1/render/`

Verification:
Run:
`docker compose config --quiet`
`docker compose up -d nginx story-service media-service render-service`

Expected:
Health endpoints reachable through nginx and direct ports.

### Task 18: Full integration verification

Objective:
Verify complete MVP path.

Steps:
1. Open `/story-studio`.
2. Select Brand Identity Surgery template.
3. Generate 6 ideas.
4. Create episode.
5. Edit characters.
6. Generate character images.
7. Generate scene images.
8. Generate Gemini scene videos.
9. Confirm generated scene video URLs are visible in Jobs/Scenes.

Commands:
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build story-service media-service render-service celery-story celery-media-image celery-media-video celery-render`

Expected:
Pipeline reaches scene video generated state without blocking other Viralo workers.

## Environment Variables

Add to `.env.example` only, not real `.env`:

```env
GEMINI_API_KEY=
GEMINI_VIDEO_MODEL=
MEDIA_STORAGE_DIR=/tmp/viralo-story-media
MEDIA_PUBLIC_BASE_URL=http://localhost:8011/storage
STORY_SERVICE_PORT=8010
MEDIA_SERVICE_PORT=8011
RENDER_SERVICE_PORT=8012
```

Do not commit real keys.

## Acceptance Criteria

Backend:
- Three new services have independent Docker containers.
- All three services expose `/health`.
- Story tables migrate successfully.
- story-service can create a draft episode with characters and scenes.
- media-service can call Gemini adapter through a normalized interface.
- Gemini implementation is isolated from story-service.
- Celery queues are split by workload.

Frontend:
- `/story-studio` exists.
- UI uses separate tabs.
- Character editor exposes only Name, Role, Personality, Voice.
- Jobs tab shows generation progress.
- Gemini is shown as current video model.

Operations:
- `docker compose config --quiet` passes.
- Existing services still boot.
- New long-running jobs do not use existing `viralo.video.generate` queue.
- Failed jobs can be retried without regenerating the whole episode.

## Recommended First Implementation Slice

Build the smallest vertical slice first:
1. story-service health endpoint
2. media-service health endpoint
3. render-service health endpoint
4. compose wiring
5. `/story-studio` frontend route with tabs
6. templates endpoint
7. static five template cards in UI

Then implement generation in this order:
1. ideas
2. episode JSON
3. character image jobs
4. scene image jobs
5. Gemini video jobs
6. render/stitching
