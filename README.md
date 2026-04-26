# frame-mog — live pose outline camera

A smart camera web app: open it in Chrome, grant camera access, and a
live pose-outline overlay appears on top of your webcam preview so you can
adjust your posture **before** pressing the shutter. No "Take photo" step is
needed for the outline to show up — the experience is fully live.

The project is a minimal but working MVP:

- **`frontend/`** — React 19 + Vite + TypeScript. Runs MediaPipe in the
  browser for real-time pose tracking.
- **`backend/`** — FastAPI. Exposes a Pydantic AI agent that the frontend
  calls at a slow cadence for higher-level reasoning. The agent runs on
  **GPT-5.3** via the **Pydantic AI Gateway**.

## 1. What the product does

1. User opens the React web app in Chrome.
2. App asks for camera permission. Stream attaches to a `<video>`.
3. MediaPipe produces 33 body landmarks per frame, in the browser.
4. The frontend matches live landmarks against five predefined templates
   (standing, hand on hip, seated, crossed legs, leaning) using a torso-
   normalized cosine-similarity matcher.
5. The chosen template's skeleton is rendered on a `<canvas>` over the
   preview, together with the live user skeleton.
6. Every ~1.5 s the frontend sends a lightweight pose context to the
   backend (landmarks, candidate template id, confidence, image size).
7. The Pydantic AI agent returns a validated `GuidanceResponse` with the
   recommended template, confidence, short guidance text, and flags for
   visibility / alignment / "suggest a different outline".
8. The HUD updates pose name, confidence %, and guidance. The overlay
   itself never blocks on the backend.

## 2. How the live camera analysis works

`useCamera` opens `getUserMedia({ video: { facingMode: 'user' } })` and
attaches the stream to the `<video>`. `usePoseLandmarker` loads
MediaPipe's Tasks Vision `PoseLandmarker` (WASM + `pose_landmarker_lite`,
both pulled from CDN and cached) and runs `detectForVideo` inside a
`requestAnimationFrame` loop.

Landmarks flow two places:

- **Overlay** (`PoseOverlay.tsx`): a separate rAF loop redraws the target
  template and the live skeleton every frame; never awaits the network.
- **Matcher** (`matcher.ts`): normalizes landmarks to hip-center origin
  and torso length, then takes cosine similarity against each template
  over ten key joints. Returns `{ templateId, score, personVisible }`.

A throttled guidance client (`backend/client.ts`) forwards the latest
match to the backend at most once per 1.5 s, aborting any still-inflight
request so guidance never arrives stale.

## 3. Why MediaPipe in the browser

MediaPipe's BlazePose WASM model runs at 20+ FPS on commodity laptops and
has a tiny network footprint once cached. It keeps the raw camera stream
on-device — no frames leave the browser for the outline to appear:

- **Fast** (≥ 20 FPS; no network round trips in the hot path).
- **Cheap** (no per-frame inference cost, no bandwidth).
- **Private** (pixels stay in the user's browser).
- **Reliable** (works even when the backend is unreachable).

## 4. Why the backend AI agent is for higher-level reasoning only

Landmark tracking is a perception task MediaPipe already solves
deterministically in milliseconds. Large models are slow, expensive, and
bad at mimicking that. What an LLM _is_ good at is reasoning over
pre-extracted context:

- Which template best fits the scene (standing / seated / leaning)?
- Is the user roughly aligned, or should we coach them?
- Should we switch templates because a different one clearly fits?
- What short, natural-language guidance should the UI show right now?

`POST /api/guidance` does exactly that — takes the pose summary the
frontend already has and returns a typed `GuidanceResponse`.

## 5. Why we don't send every frame

Streaming video to a remote service at 30 FPS would cost ~10–100× more
bandwidth and latency than the rest of the pipeline, and would serialize
the camera preview behind network round trips. Since MediaPipe already
produces a tiny descriptive representation (33 landmarks, ~1 KB), we send
_that_ every ~1.5 s. The frontend throttles and aborts stale requests so
backend load stays bounded regardless of frame rate.

Side benefit: the camera overlay keeps working even if the backend is
slow or offline.

## 6. Why predefined templates beat AI-generated outlines

Asking an LLM to invent outline coordinates every frame would produce
jittery, non-deterministic geometry, silently-invalid poses, latency
coupled to the model's tail latency, and no way to A/B curated poses.

A fixed library of five designer-chosen templates sidesteps all of this.
The agent's role is narrowed to **picking which template to show** and
**explaining what to adjust**, not to drawing the outline itself.

## 7. How to run it locally

Requirements: Python 3.11+ with [uv](https://docs.astral.sh/uv/),
Node.js 20+, and [bun](https://bun.sh/) (any npm-compatible runner also
works — the repo uses a `bun.lock`).

### Backend

Create a Pydantic AI Gateway API key at
[logfire.pydantic.dev](https://logfire.pydantic.dev) and drop it in
`backend/.env`:

```bash
cd backend
cp .env.example .env
# edit .env and set PYDANTIC_AI_GATEWAY_API_KEY=pylf_v...
uv sync
uv run uvicorn app.main:app --reload
```

Endpoints:

- `GET  /health` — `{ "status": "ok", "model": "openai/gpt-5.4-mini" }` (or your `AGENT_MODEL`)
- `GET  /api/templates` — template metadata
- `POST /api/guidance` — `PoseContext` → `GuidanceResponse`

The pose agent uses `openai/gpt-5.4-mini` on OpenRouter by default; set `AGENT_MODEL` in
`.env` to any OpenRouter chat model slug you prefer.

### Frontend

```bash
cd frontend
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome. The Vite
dev server proxies `/api` and `/health` to `http://localhost:8000`, so
no CORS configuration is needed in development.

### Tests

```bash
cd backend  && uv run pytest -q
cd frontend && bun run lint && bun run build
```

## 8. Current MVP limitations

- Single person, front-facing camera only.
- Templates are static 2-D front views; no side profiles or rotations.
- Cosine similarity normalizes by torso length but is not fully scale-
  invariant under extreme foreshortening.
- `snapshot_b64` is wired through the schema but unused by the
  text-only agent; a multimodal model is needed to make use of it.
- No auth / rate limiting / persistent logging on the backend.
- Chrome desktop / Android in practice; iOS Safari has limited
  `getUserMedia` behavior for some flows.

## 9. Suggested next steps

- Switch the agent to a multimodal model and feed the optional snapshot
  so it can comment on lighting and composition.
- Add template variants per aspect ratio (9:16 / 4:3 / 16:9) and auto-
  pick based on video element size.
- Temporal smoothing (EMA) on confidence to avoid flicker when two
  templates score similarly.
- Capture + export flow: "Take photo" button that saves a full-res
  frame tagged with the matched template.

## Architecture at a glance

```
Browser (React)
 ├── getUserMedia → <video>
 ├── MediaPipe PoseLandmarker (WASM, rAF loop)        ← real-time
 ├── matchTemplate(live, TEMPLATES)                    ← cosine similarity
 ├── PoseOverlay <canvas>                              ← real-time
 └── GuidanceClient  ─── POST /api/guidance (~1.5 s) ──┐
                                                        ▼
                                                 FastAPI
                                                 └── Pydantic AI Agent
                                                      └── openai/gpt-5.4-mini
                                                           (OpenRouter)
```

## Repo layout

```
backend/
  app/
    main.py          FastAPI app + Pydantic AI agent + routes
    schemas.py       Landmark, PoseContext, GuidanceResponse, TemplateMeta
    templates.py     5 template metadata entries
  tests/             Route smoke tests
  pyproject.toml
  .env.example

frontend/
  src/
    camera/useCamera.ts            Camera permission state machine
    pose/mediapipe.ts              PoseLandmarker factory + constants
    pose/usePoseLandmarker.ts      rAF detection loop
    pose/templates.ts              5 templates (normalized landmarks)
    pose/matcher.ts                Cosine-similarity matcher
    overlay/PoseOverlay.tsx        Canvas overlay renderer
    backend/client.ts              Throttled guidance client
    App.tsx / App.css              App shell + HUD
  vite.config.ts                   /api + /health proxy in dev
```
# Sat Apr 25 19:08:19 BST 2026
