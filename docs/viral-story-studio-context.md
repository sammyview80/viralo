# Viralo Story Studio Context

## Product Idea

Build a Viralo feature/app that creates short, TikTok-style AI video stories from viral story templates.

Working names:
- Viralo Story Studio
- ViralVerse
- StoryTok AI
- Viral Story Studio

Core promise:
Turn viral story templates into AI videos in minutes. Users pick a story universe, generate dramatic episode ideas, create consistent characters, edit scenes, and export vertical short-form video.

Primary users:
- TikTok/Reels creators
- Faceless content creators
- Meme page owners
- Short-form AI video agencies
- Creators who want to copy trending AI story formats quickly

## Core Product Flow

The main flow should be template-first, not blank-prompt-first.

Flow:
1. Series/template selection
2. AI-generated scenario ideas
3. Full editable episode builder
4. Character image generation
5. Scene image/video generation
6. TTS, captions, and final video stitching

The important product insight is that users should never get stuck thinking from scratch. Templates and AI-generated premise cards remove creative friction.

## MVP Scope

Start with a storyboard-to-video generator rather than a complete video generator.

Phase 1:
- Series templates
- Generate 6 story ideas
- Generate full scene list
- Editable scene cards
- Generate image prompts for each scene
- Export/copy prompts and screenplay

Phase 2:
- Character image generation
- Scene image generation
- Storyboard preview

Phase 3:
- Image-to-video generation
- TTS voice generation
- FFmpeg video stitching
- Burned-in TikTok-style captions

Phase 4:
- Clone viral video from TikTok/Reels URL
- Template marketplace
- Batch generation
- Reusable characters across episodes

## Initial Templates

Launch with 5 templates instead of 20+.

### 1. Brand Identity Surgery

Characters:
Pepsi, Coca-Cola, Android, iPhone, Nike, Adidas, budget/luxury brands.

Drama formula:
A rejected character wants to transform into a rival identity to gain social status. They face family conflict, undergo transformation, and discover the emotional cost.

Example:
A Pepsi child begs for Coca-Cola surgery after being rejected by popular red-can classmates.

### 2. Cheating Objects

Characters:
Fruits, snacks, toys, drinks, household items.

Drama formula:
One object cheats on another, creating a soap-opera-style betrayal with exaggerated emotion.

Example:
A strawberry husband cheats with a mango, and his banana wife discovers the truth.

### 3. Poor vs Rich Transformation

Characters:
Cheap toy, luxury toy, budget phone, premium phone, generic shoes, designer shoes.

Drama formula:
A poor or low-status character transforms to join elite society, then learns status has a cost.

Example:
A cheap Android phone begs to become an iPhone after being mocked by rich classmates.

### 4. Forbidden Love

Characters:
Rival brands, fruits, animals, apps, objects from enemy groups.

Drama formula:
Two characters from enemy worlds fall in love despite family/social opposition.

Example:
A McDonald's kid falls in love with a Burger King girl, starting a family feud.

### 5. School Bully Makeover

Characters:
Kids represented as brands, objects, foods, toys, or apps.

Drama formula:
A bullied character changes identity, becomes popular, then regrets losing their original self.

Example:
A Fanta teen gets mocked as childish and begs a doctor to become dark, serious cola.

## Template Data Structure

Each series template should include:

```json
{
  "title": "Soda Identity Crisis",
  "description": "A soda brand child wants to transform into a rival brand to gain status.",
  "genre": "identity drama / comedy",
  "character_archetype": "anthropomorphic soda cans",
  "roles": ["child", "mother", "father", "doctor", "bully"],
  "visual_style": "cinematic Pixar-like 3D, expressive soda can characters, dramatic lighting",
  "dramatic_formula": "A rejected character wants to transform into a rival identity, faces family conflict, undergoes surgery, then discovers the emotional cost.",
  "cover_image_url": null,
  "sample_video_url": null
}
```

## Step 1: Template Selection

UI:
- 3-step wizard/stepper
- Card grid of templates
- Each card has title, cover image, one-line description, genre tags, and sample preview

User action:
Select one template and continue.

## Step 2: Scenario Selection

Two modes:

### Ideas Mode

AI generates 6 premise cards.

Each card includes:
- punchy title
- 1-2 sentence premise
- conflict
- viral hook

Example ideas for Soda Identity Crisis:

1. Pepsi Wants to Become Coca-Cola
A Pepsi kid begs for Coca-Cola surgery after being rejected by popular red-can students.

2. Sprite Kid Wants to Become Mountain Dew
A quiet Sprite child wants to become extreme and neon-green to impress skater classmates.

3. Coca-Cola Girl Hides Her Pepsi Boyfriend
A Coca-Cola daughter falls in love with a Pepsi boy, but her brand-loyal family forbids it.

4. Dr Pepper Gets Replaced
A Dr Pepper kid discovers his parents secretly adopted a Coca-Cola child because he is more popular.

5. Fanta Wants to Be Taken Seriously
A Fanta teen gets mocked as childish and begs a doctor to become dark, serious cola.

6. The Diet Coke Secret
A regular Coke father discovers his son secretly identifies as Diet Coke and wants a label-change operation.

### Custom Mode

Fields:
- protagonist
- rival/love interest/affair partner/transformation target, depending on template
- extra details
- scene count
- scene length
- language

Useful buttons:
- Shuffle Pair
- Ask AI
- Regenerate Ideas

Default settings:
- scene_count: 8-10
- scene_length: 8 seconds
- aspect_ratio: 9:16
- language: English by default, multi-language later

## Step 3: Episode Builder

The AI expands the selected premise into a full editable episode.

Generate:
- cast
- character descriptions
- reference image prompts
- scene list
- setting per scene
- action per scene
- characters in each scene
- dialogue
- image prompt
- video prompt
- caption text

Each scene should include:
- title
- duration
- setting
- action
- characters
- dialogue
- image_prompt
- video_prompt
- caption

Example scene:

```json
{
  "scene_number": 1,
  "title": "The Cafeteria Rejection",
  "duration_seconds": 8,
  "setting": "A shiny school cafeteria filled with colorful soda-can students sitting at brand-themed tables.",
  "action": "Penny Pepsi walks toward the popular Coca-Cola table holding his lunch tray. The Coca-Cola kids look at him and laugh.",
  "characters": ["Penny Pepsi", "Cody Coca-Cola"],
  "dialogue": [
    {"character": "Penny Pepsi", "line": "Can I sit with you guys today?"},
    {"character": "Cody Coca-Cola", "line": "Sorry. This table is for real classics only."},
    {"character": "Penny Pepsi", "line": "But I'm sweet too."},
    {"character": "Cody Coca-Cola", "line": "You're backup soda."}
  ],
  "image_prompt": "Vertical 9:16 cinematic 3D scene of an anthropomorphic small Pepsi can child standing sadly in a colorful school cafeteria while confident Coca-Cola can students laugh at a red table, expressive cartoon faces, dramatic lighting, viral TikTok AI video style.",
  "video_prompt": "The Pepsi child slowly lowers his lunch tray as the Coca-Cola students laugh. Camera pushes in on his sad face.",
  "caption": "POV: You're born as the wrong soda..."
}
```

## Character Consistency System

This is the hardest technical challenge.

MVP approach:
1. Generate one canonical reference image per character first.
2. Save a strict character description/persona lock.
3. Reuse that exact description in every scene prompt.
4. Use reference images for scene generation whenever the provider supports it.

Example character lock:

Penny Pepsi:
Small blue Pepsi soda can child, big worried eyes, silver rim, red-white-blue Pepsi logo on chest, tiny white sneakers, nervous expression.

Every scene featuring Penny should reuse this exact description.

Future improvements:
- IP-Adapter
- ControlNet
- LoRA
- Runway character references
- Kling image references
- ComfyUI reference-guided workflows

## Suggested Technical Stack

Frontend:
- Next.js or React
- Tailwind
- Stepper wizard
- Card grid
- Editable scene cards
- Right sidebar summary

Backend:
- Node.js or Python FastAPI
- PostgreSQL
- Redis queue
- Celery or BullMQ for async generation
- S3/R2 for media storage

AI providers:
- LLM: GPT-4.1, Claude, Gemini, or equivalent for structured story JSON
- Images: Flux, DALL-E, Ideogram, Replicate models, or Stable Diffusion
- Video: Kling, Runway, Luma, Grok Imagine-like provider, or Replicate video models
- Voice: ElevenLabs, OpenAI TTS, Cartesia, or PlayHT
- Stitching: FFmpeg

## Database Models

### SeriesTemplate

Fields:
- id
- title
- description
- genre
- character_archetype
- visual_style
- dramatic_formula
- role_schema
- cover_image_url
- sample_video_url
- created_at
- updated_at

### StoryIdea

Fields:
- id
- template_id
- title
- premise
- characters_seed
- language
- created_at

### Episode

Fields:
- id
- user_id
- template_id
- premise
- scene_count
- scene_length_seconds
- aspect_ratio
- language
- status
- total_duration_seconds
- final_video_url
- created_at
- updated_at

### Character

Fields:
- id
- episode_id
- name
- role
- description
- reference_image_prompt
- image_url
- voice_id
- created_at
- updated_at

### Scene

Fields:
- id
- episode_id
- scene_number
- title
- duration_seconds
- setting
- action
- dialogue_json
- characters_json
- image_prompt
- video_prompt
- caption
- image_url
- video_url
- created_at
- updated_at

### GenerationJob

Fields:
- id
- episode_id
- type
- status
- provider
- cost_tokens
- error_message
- result_url
- created_at
- updated_at

## LLM Prompt: Generate Ideas

System:
You are a viral TikTok AI story writer. You create emotionally dramatic, funny, highly shareable short-video premises.

User:
Generate 6 story premises for this series template.

Template:
{{series_template_json}}

Requirements:
- Each idea must have a punchy title.
- Each idea must include a 1-2 sentence premise.
- Each idea must have clear conflict.
- Each idea must have a strong viral hook.
- The story must fit a 60-90 second vertical video.
- Return valid JSON only.

Output schema:

```json
{
  "ideas": [
    {
      "title": "string",
      "premise": "string",
      "conflict": "string",
      "viral_hook": "string"
    }
  ]
}
```

## LLM Prompt: Generate Episode

System:
You are a viral short-form AI video writer and storyboard director. You create dramatic, funny, visually clear stories for TikTok/Reels.

User:
Expand this premise into a full vertical AI video episode.

Series template:
{{series_template_json}}

Premise:
{{premise}}

Settings:
- scene_count: {{scene_count}}
- scene_length_seconds: {{scene_length_seconds}}
- language: {{language}}
- aspect_ratio: 9:16

Requirements:
- Return valid JSON only.
- Create a cast of 3-6 characters.
- Each character needs name, role, description, and reference_image_prompt.
- Each scene needs title, setting, action, characters, dialogue, image_prompt, video_prompt, and caption.
- Keep dialogue short and emotional.
- Make every scene visually distinct.
- Maintain consistent character descriptions across scenes.
- Use viral TikTok-style hooks and captions.

Output schema:

```json
{
  "title": "string",
  "premise": "string",
  "cast": [
    {
      "name": "string",
      "role": "string",
      "description": "string",
      "reference_image_prompt": "string",
      "voice_style": "string"
    }
  ],
  "scenes": [
    {
      "scene_number": 1,
      "title": "string",
      "duration_seconds": 8,
      "setting": "string",
      "action": "string",
      "characters": ["string"],
      "dialogue": [
        {"character": "string", "line": "string"}
      ],
      "image_prompt": "string",
      "video_prompt": "string",
      "caption": "string"
    }
  ]
}
```

## UX Notes

Frontend components:
- 3-step wizard
- Template grid
- Scenario cards
- Custom premise form
- Scene count dropdown
- Scene length dropdown
- Language selector
- Character manager
- Editable scene cards
- Right sidebar summary
- Video model selector
- Aspect ratio selector
- Generate buttons with job status

Right sidebar summary:
- Series name
- Cast names
- Scene count
- Estimated duration
- Selected model
- Token estimate

Important UX principle:
Keep information compact. Use progressive disclosure for long scene details, tags, descriptions, and generated prompts.

## Token/Credit System

Possible pricing logic:
- Idea generation: low cost/free
- Episode generation: low cost
- Character image generation: around 1-2 tokens per character
- Scene image generation: per scene
- Final video generation: high cost, around 20-30 tokens

Example:
- Generate character images: 1.5 tokens per character
- Create final video: 29 tokens

## Differentiators

The moat is not the video model. Anyone can call Kling, Runway, or Luma.

The moat is:
- viral templates
- reusable story formulas
- low-friction idea generation
- character consistency
- easy scene editing
- reusable universes
- trend cloning
- batch short-form workflow

Potential advanced features:
- Clone Any Viral Video: paste TikTok/Reels URL and generate a similar story structure
- Template marketplace
- Viral score for each premise
- Batch generation of 10 variants
- Brand-safe mode
- Localized drama in multiple languages
- Reusable characters across episodes

## Homepage Copy

Headline:
Turn viral story templates into AI videos in minutes.

Subheadline:
Pick a story universe, generate dramatic episode ideas, create consistent characters, and export TikTok-ready AI video stories.

CTA:
Create Your First Viral Story

## Pricing Concept

Free:
- 3 story generations
- 1 storyboard export
- watermark

Starter:
- $19/month
- 30 videos/month
- basic templates

Creator:
- $49/month
- 100 videos/month
- custom templates
- no watermark

Agency:
- $149/month
- batch generation
- team workspace
- API access

## Recommended Next Build Step

Build this first:
1. Create Story button
2. Template picker with 5 templates
3. Generate 6 ideas
4. Pick idea
5. Generate 8-scene episode as JSON
6. Show editable scene cards
7. Generate image prompts for each scene
8. Let user copy/export prompts

Then add:
9. Generate character images
10. Generate scene images
11. Generate video clips
12. Add voice
13. Stitch final video

---

# Technical Specification: Character Generation to Final Video

## Character Data Model

The character editor should stay intentionally simple. Each character stores four creator-facing fields:

1. Name
   - Display name used in UI, dialogue, prompts, and captions.
   - Example: Pico Pepsi

2. Role
   - Narrative function inside the episode.
   - Examples: The Child, Mother, Father, Doctor, Transformed Child, Bully, Affair Partner.

3. Personality
   - Paragraph describing emotional arc, motivation, behavior, and dialogue style.
   - Used by the LLM for dialogue and by image/video prompts for expression and pose guidance.
   - Example: A fed-up kid who is tired of being treated like second place. He starts wounded and embarrassed, then turns cocky and electric after the surgery.

4. Voice
   - TTS descriptor string containing pitch, age, accent, delivery style, and quirks.
   - Used directly as a voice style prompt during TTS generation.
   - Can be blank; fallback should use a generic gender/age cue inferred from role/personality.
   - Example: bright teen tenor, early teens, crisp Midwestern clip, fast annoyed delivery with sarcastic pop.

Important design insight:
There does not need to be a separate user-facing appearance field in the MVP. Appearance can be derived from:
- character name, such as Pepsi, Coca-Cola, iPhone, Mango, Strawberry
- role, such as child, doctor, mother
- series template art style, such as anthropomorphic soda bottles in cinematic 3D
- generated reference image

Internally, the app may still generate and store a hidden appearance_lock field after the first character image is created. This helps consistency without making the UI complicated.

Suggested internal character model:

```json
{
  "id": "char_123",
  "episode_id": "ep_123",
  "name": "Pico Pepsi",
  "role": "The Child",
  "personality": "A fed-up kid who is tired of being treated like second place. He starts wounded and embarrassed, then turns cocky and electric after the surgery.",
  "voice": "bright teen tenor, early teens, crisp Midwestern clip, fast annoyed delivery with sarcastic pop",
  "appearance_lock": "small blue Pepsi bottle child, red-white-blue label, silver cap, big worried eyes, tiny white sneakers",
  "reference_image_url": "https://...",
  "reference_image_status": "ready"
}
```

## Character Image Generation Pipeline

Goal:
Generate one canonical reference image for each character before generating scene images.

Recommended model options:
- GPT Image 2.0 / OpenAI image model with image consistency support
- Flux Kontext for strong reference-based consistency
- DALL-E 3 for simpler early MVP images
- SDXL/Flux with IP-Adapter for open-source pipeline

Cost model reference:
- around 1.5 tokens per character image
- show progress as character images become ready, e.g. 0/5 ready, 1/5 ready, etc.

Prompt construction:

```text
{SERIES_STYLE_PROMPT}
Character portrait for an AI video story.
Name: {CHARACTER_NAME}
Role: {CHARACTER_ROLE}
Personality: {CHARACTER_PERSONALITY}
Create a full-body character reference image on a clean neutral background.
Make the character visually distinctive and easy to recognize across scenes.
Use consistent lighting, centered composition, and no text labels.
Aspect ratio: 9:16 or 1:1 depending on provider support.
```

Example:

```text
Cinematic 3D Pixar-style anthropomorphic soda bottle world, expressive faces, soft dramatic lighting.
Character portrait for an AI video story.
Name: Pico Pepsi
Role: The Child
Personality: A fed-up kid who is tired of being treated like second place. He starts wounded and embarrassed, then turns cocky and electric after the surgery.
Create a young male Pepsi bottle with a small cap, red-and-blue label, slightly hunched insecure posture, big expressive eyes, full body visible, neutral background, consistent lighting, no text labels.
```

Implementation notes:
- Generate one image request per character.
- Store each generated image URL on the Character record.
- Mark status as pending, generating, ready, or failed.
- If generation fails for one character, allow retry for that character only.
- The generated character reference image becomes a required input for scene image generation.

## Scene Image Generation Pipeline

Each scene has three essential visual inputs:

1. Setting
   - Rich environment description.
   - Example: Warm suburban dining room at dusk, wooden table set with blue napkins, family photos, and a bowl of chips under amber ceiling light.

2. Action
   - What physically happens in the scene.
   - Example: Pico slaps both little bottle hands on the table edge while the parents freeze in place.

3. Active characters
   - List of tagged characters appearing in the scene.
   - Each active character should contribute its name, role, personality, hidden appearance lock, and reference image.

Prompt construction:

```python
scene_image_prompt = f"""
{series_style_prompt}
Vertical 9:16 frame for a viral AI video story.
Scene setting: {scene.setting}
Action: {scene.action}
Characters present: {', '.join([c.name for c in active_characters])}
Maintain exact visual consistency with the provided character reference images.
Keep character proportions, colors, faces, labels, outfits, and silhouettes consistent.
Cinematic lighting, clear emotional expressions, no subtitles, no text overlays.
"""
```

Attached references:
- Include each active character's reference image as an image input if the provider supports it.
- For open-source models, use IP-Adapter/ControlNet/reference-guided generation.
- For GPT Image-style workflows, provide reference images as input images and instruct consistency explicitly.

Important:
Captions should not be generated inside the scene image. Captions are added later during video post-processing.

## Image to Video Pipeline

The video workflow should be image-to-video, not pure text-to-video.

Reason:
The scene image grounds the setting and characters. This gives much better consistency than text-to-video alone.

Pipeline for each scene:
1. Generate the scene image.
2. Pass the scene image to an image-to-video model.
3. Use the scene action as the motion prompt.
4. Generate an 8-second clip.
5. Store clip URL on the Scene record.

Recommended model options:
- Grok Imagine-style image-to-video
- Runway Gen-3/Gen-4
- Kling
- Luma Dream Machine
- Wan 2.1
- Replicate-hosted video models

Motion prompt construction:

```text
{scene.action}
Subtle ambient movement, expressive character motion, cinematic camera push-in, no scene cuts, keep all characters visually consistent with the input image, preserve the composition.
Duration: {scene.duration_seconds} seconds.
```

Example:

```text
Pico Pepsi slaps both little bottle hands on the table edge while his parents freeze in shock. Subtle ambient dining room motion, warm light flicker, cinematic camera slowly pushes toward Pico's angry face. No scene cuts. Preserve the characters and setting exactly from the input image.
```

## Voice and TTS Pipeline

Each character's Voice field feeds directly into TTS synthesis.

Dialogue parsing:
- Dialogue should be stored as structured JSON, not raw text only.
- Each line should include character name and text.

Example:

```json
[
  {"character": "Pico Pepsi", "line": "I want Coca-Cola surgery. I'm done being Pepsi."},
  {"character": "Mara Pepsi", "line": "Don't get ideas, boy. We're a Pepsi family."},
  {"character": "Dale Pepsi", "line": "We do not crawl to the red can."}
]
```

TTS generation:

```python
tts_voice_prompt = character.voice or fallback_voice_for(character)
tts_text = dialogue_line.text
audio_clip = tts_client.generate(
    text=tts_text,
    voice_style=tts_voice_prompt
)
```

Recommended TTS options:
- ElevenLabs for voice style prompting and consistency
- OpenAI TTS for simpler integration
- Cartesia
- PlayHT

Audio timeline:
- Generate audio per dialogue line.
- Insert short pauses between lines.
- Fit the scene audio inside the scene duration.
- If audio is too long, either extend scene duration or ask the LLM to shorten dialogue.

## Caption and Subtitle System

Captions should be added in post-processing, not inside generated images or videos.

Target visual style:
- Heavy black/bold sans-serif font, Impact-like
- All caps or mostly all caps
- Lower-center position, around bottom 15-20% of frame
- White inactive words
- Bright active word highlight, such as green, yellow, gold, or series-matched accent color
- Slightly larger active word size
- Optional dark shadow/stroke for readability
- Karaoke-style word-by-word highlighting synchronized to speech

Caption process:
1. Generate TTS audio.
2. Run forced alignment to get word-level timestamps.
3. Render captions frame-by-frame with one active highlighted word.
4. Composite captions onto each scene video.

Word timing options:
- WhisperX forced alignment
- Whisper timestamps plus refinement
- Provider-generated word timestamps if available from TTS/STT vendor

Recommended caption rendering approach:
- Use Python + Pillow/Cairo to render transparent caption overlay frames.
- Composite overlay on video with FFmpeg.
- Avoid complex FFmpeg drawtext chains for per-word dynamic highlighting unless necessary.

FFmpeg drawtext can work for simple captions, but dynamic word-level highlighting is easier with rendered overlays.

Caption rendering pseudocode:

```python
for frame_time in video_frame_times:
    active_word = find_word_at_time(words, frame_time)
    caption_image = render_caption_line(
        words=words,
        active_word=active_word,
        inactive_color="white",
        active_color="lime",
        font="Impact",
        position="bottom_center"
    )
    composite_caption_frame(video_frame, caption_image)
```

## Final Video Stitching Pipeline

For each scene:
1. Build image prompt from series style + setting + action + character references.
2. Generate scene image.
3. Generate image-to-video clip from scene image + motion prompt.
4. Generate TTS audio for dialogue lines.
5. Align audio to get word-level timestamps.
6. Composite video clip + scene audio + caption overlay.
7. Export scene_N.mp4.

Final assembly:
1. Concatenate all scene clips into final.mp4.
2. Add optional background music at low volume.
3. Normalize loudness.
4. Export in 9:16, ideally 1080x1920.
5. Store final video URL on Episode.

FFmpeg responsibilities:
- concatenate clips
- mix voice audio and background music
- normalize loudness
- encode final MP4
- burn in caption overlay

## Generation Job State Machine

Episode statuses:
- draft
- generating_characters
- characters_ready
- generating_scene_images
- scene_images_ready
- generating_video_clips
- video_clips_ready
- generating_audio
- rendering_captions
- stitching
- completed
- failed

Per-job statuses:
- queued
- running
- succeeded
- failed
- retrying
- cancelled

Recommended job types:
- generate_story_ideas
- generate_episode
- generate_character_image
- generate_scene_image
- generate_scene_video
- generate_tts_line
- align_captions
- render_scene
- stitch_final_video

## Technical Libraries and Providers

| Task | Suggested Tools |
|---|---|
| Story + scene generation | GPT-4o, GPT-4.1, Claude, Gemini |
| Character image generation | GPT Image 2.0, DALL-E 3, Flux Kontext |
| Character consistency | IP-Adapter, ControlNet, GPT Image references, Flux Kontext |
| Scene image generation | GPT Image 2.0, Flux Kontext, SDXL/Flux |
| Image to video | Kling, Runway, Luma, Wan 2.1, Grok Imagine-style model |
| TTS voice synthesis | ElevenLabs, OpenAI TTS, Cartesia, PlayHT |
| Word-level timing | WhisperX, Whisper forced alignment, provider timestamps |
| Caption rendering | MoviePy + Pillow, Cairo, FFmpeg overlay |
| Video stitching | FFmpeg, MoviePy |
| Queue | Celery + Redis, BullMQ + Redis |
| Storage | S3, Cloudflare R2 |

## Important Consistency Strategy

Use these four tactics together:

1. Brand/object-name characters
   - Pepsi, Coca-Cola, iPhone, Mango, Strawberry, etc. already have strong visual priors.

2. Character reference image
   - Generate once, inject into every scene image request.

3. Series art style lock
   - Every image prompt starts with the same series style prefix.

4. Hidden appearance lock
   - After character generation, store a concise internal description and reuse it in all scene prompts.

Simplest MVP recommendation:
Use Flux Kontext or any provider that supports reference image consistency. Generate canonical character portraits first, then pass those references into each scene image call.

## Engineering Risks

Major risks:
- Character inconsistency across scenes
- Video model changing character details during motion
- TTS audio exceeding scene duration
- Caption timing mismatch
- Long-running generation jobs timing out
- Provider failures or high costs
- Trademark/brand safety concerns

Mitigations:
- Use reference images for all scene images.
- Use image-to-video instead of text-to-video.
- Keep motion prompts simple.
- Shorten dialogue automatically if it exceeds scene duration.
- Use async jobs with retries.
- Store intermediate assets so failed steps can resume.
- Add brand-safe mode for templates that avoid real trademarks.

## MVP Technical Priority

Build in this order:
1. Structured episode JSON generation.
2. Character editor with Name, Role, Personality, Voice.
3. Character image generation with status tracker.
4. Scene editor with Setting, Action, Characters, Dialogue.
5. Scene image generation from character references.
6. Export storyboard assets.
7. Image-to-video scene clip generation.
8. TTS per dialogue line.
9. Word-level captions.
10. FFmpeg final stitching.
