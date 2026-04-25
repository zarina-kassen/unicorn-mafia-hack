# frame-mog — live pose outline camera

A Huawei-style camera web app: open it in Chrome, grant camera access, and a
live pose-outline overlay appears on top of your webcam preview so you can
adjust your posture **before** pressing the shutter. No "Take photo" step is
needed for the outline to show up — the experience is fully live.

The project is a minimal but working MVP split into two pieces:

- **`frontend/`** — React 19 + Vite + TypeScript. Runs MediaPipe in the
  browser for real-time pose tracking.
- **`backend/`** — FastAPI (uv). Exposes a Pydantic-AI guidance agent that
  the frontend calls at a slow cadence for higher-level reasoning. A mock
  provider is included so the app works without any API key.

## 1. What the product does

1. User opens the React web app in Chrome.
2. App asks for camera permission. Stream attaches to a `<video>` element.
3. MediaPipe runs in the browser and produces 33 body landmarks per frame.
4. The frontend matches live landmarks against five predefined templates
   (standing, hand on hip, seated, crossed legs, leaning) using a torso-
   normalized cosine-similarity matcher.
5. The chosen template's skeleton is rendered over the live preview on a
   `<canvas>`, together with the live user skeleton for reference.
6. Every ~1.5 s the frontend sends a lightweight pose context (landmarks,
   candidate template id, confidence, image size) to the FastAPI backend.
7. The backend's Pydantic-AI agent returns a validated `GuidanceResponse`
   with the recommended template, confidence, short guidance text, and
   flags for visibility / alignment / "suggest a different outline".
8. The HUD updates the pose name, confidence %, and guidance text. The
   overlay itself never blocks on the backend.

## 2. How the live camera analysis works

`useCamera` opens `getUserMedia({ video: { facingMode: 'user' } })` and
attaches the stream to the `<video>`. `usePoseLandmarker` lazily loads
MediaPipe's Tasks Vision `PoseLandmarker` (WASM + `pose_landmarker_lite`
model, both pulled from CDN the first time) and runs `detectForVideo` inside
a `requestAnimationFrame` loop, so detection tracks the browser's paint
cadence.

Landmarks flow two places:

- **Overlay** (`PoseOverlay.tsx`): a separate rAF loop redraws the target
  template and the live skeleton onto a resize-aware canvas. Runs every
  frame; never awaits any network call.
- **Local matcher** (`matcher.ts`): normalizes landmarks to hip-center origin
  and torso length, then takes cosine similarity against each template's
  normalized vector over ten key joints (shoulders, elbows, wrists, hips,
  knees). Returns `{ templateId, score, personVisible }`.

A throttled guidance client (`backend/client.ts`) forwards the latest match
to the backend at most once per `intervalMs` (default 1.5 s), aborting any
still-inflight request so the user always gets fresh guidance.

## 3. Why MediaPipe in the browser

MediaPipe's BlazePose WASM model runs at 20+ FPS on commodity laptops and has
a tiny network footprint once cached. Crucially, it lets us keep the raw
camera stream on-device: no frames ever need to leave the browser for the
outline to appear. That is:

- **Fast** (≥ 20 FPS; no network round trips in the hot path).
- **Cheap** (no per-frame inference cost, no bandwidth).
- **Private** (pixels stay in the user's browser by default).
- **Reliable** (works when the backend or AI provider is offline).

## 4. Why the backend AI agent is for higher-level reasoning only

Landmark tracking is a well-defined perception task that MediaPipe already
does deterministically in milliseconds. Large language models are bad at
mimicking that (they're slow, expensive, and hallucinate coordinates). What
an LLM _is_ good at is reasoning over pre-extracted context:

- Which template best fits the overall scene (standing vs. seated vs. leaning)?
- Is the user roughly aligned with the template, or should we coach them?
- Should we switch templates because the user clearly wants a different one?
- What short, natural-language guidance should the UI show right now?

That is exactly what `/api/guidance` does — it takes the pose summary that
the frontend already has and returns a structured `GuidanceResponse`.

## 5. Why we don't send every frame

Sending video frames at 30 FPS to a remote service would cost ~10–100× more
bandwidth and latency than the entire rest of the pipeline, and would
serialize the camera preview behind network round trips. Since MediaPipe
already produces a tiny, descriptive representation of the pose (33
landmarks, ~1 KB), we send _that_ every ~1.5 s. The frontend throttles +
de-dupes in-flight requests so backend load stays bounded regardless of
frame rate.

Side benefits: the app continues to work if the backend is offline, if the
AI provider is down, or if the user has a flaky connection.

## 6. Why predefined templates beat AI-generated outlines

Asking an LLM to invent outline coordinates every frame would produce:

- jittery, non-deterministic geometry that shifts between requests;
- silently-invalid poses (wrong joint counts, impossible angles);
- latency spikes coupled to the model's tail latency;
- no way to A/B curated "good" poses against each other.

A fixed library of five designer-chosen templates sidesteps all of this.
The AI's role is narrowed to **picking which template to show** and
**explaining what to adjust**, not to rendering the outline itself.

## 7. How to run it locally

Requirements: Python 3.11+ (with [uv](https://docs.astral.sh/uv/)),
Node.js 20+, and [bun](https://bun.sh/) (repo uses a `bun.lock`; `npm` or
`pnpm` also works).

### Backend

```bash
cd backend
cp .env.example .env      # defaults to AI_PROVIDER=mock, no key needed
uv sync
uv run uvicorn app.main:app --reload
```

The backend serves:

- `GET  /health` — `{ "status": "ok", "provider": "mock" }`
- `GET  /api/templates` — template metadata
- `POST /api/guidance` — guidance for a pose context

To use a real model instead of the mock, set:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
# AGENT_MODEL=openai:gpt-4o-mini  (default)
```

The `AGENT_MODEL` value is passed straight through to Pydantic-AI, so any
supported model string works. `gpt-4o-mini` was chosen as the default
because it is fast, cheap, and reliable at structured outputs.

### Frontend

```bash
cd frontend
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in Chrome. The Vite dev
server proxies `/api` and `/health` to `http://localhost:8000`, so no CORS
configuration is needed in development.

### Tests

```bash
cd backend && uv run pytest -q
cd frontend && bun run lint && bun run build
```

## 8. Current MVP limitations

- **Single person, front-facing camera only.** BlazePose lite is tuned for
  one subject; multi-person support would need a different model.
- **Templates are static 2-D front views.** A side-profile template would
  need its own landmark geometry and matching weights.
- **Cosine similarity is not fully scale-invariant.** It normalizes by torso
  length, but extreme foreshortening can still bias scores.
- **Snapshot field is defined but not yet used** by the mock agent. The
  Pydantic-AI agent is text-only in this build; swap in a multimodal model
  to consume `snapshot_b64`.
- **No auth / rate limiting / logging** on the backend beyond the request
  timeout — this is an MVP, not a production deployment.
- **Chrome desktop/Android only in practice**; iOS Safari has limited
  `getUserMedia` behavior for some flows.

## 9. Suggested next steps

- Ship a multimodal provider (`AGENT_MODEL=openai:gpt-4o` or Gemini 1.5
  Flash) and feed the optional JPEG snapshot so the agent can comment on
  lighting / composition.
- Add template **variants per aspect ratio** (9:16 vs 4:3 vs 16:9) and pick
  automatically based on the video element size.
- Temporal smoothing of the match score (EMA) to avoid flicker when two
  templates score similarly.
- Scene classifier (indoor / outdoor / dark) to bias template choice.
- Offline fallback templates per locale and a local, on-device LLM option.
- Capture + export flow: "Take photo" button that saves a full-res frame
  with EXIF noting the matched template.

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
                                                 └── get_agent()
                                                      ├── MockAgent (default)
                                                      └── PydanticAIAgent
                                                           └── Agent(output_type=GuidanceResponse)
```

## Repo layout

```
backend/
  app/
    main.py                    FastAPI app + routes + CORS
    schemas.py                 Pydantic models (Landmark, PoseContext, GuidanceResponse)
    templates.py               Template metadata (ids/names/postures)
    agents/
      provider.py              Provider abstraction + factory
      mock.py                  Deterministic mock (no API key)
      pydantic_ai_agent.py     Pydantic-AI Agent w/ structured output
  tests/test_guidance.py       Route + agent smoke tests
  pyproject.toml               uv project
  .env.example

frontend/
  src/
    camera/useCamera.ts        getUserMedia + permission state machine
    pose/mediapipe.ts          PoseLandmarker factory + constants
    pose/usePoseLandmarker.ts  rAF detection loop
    pose/templates.ts          5 predefined templates (normalized landmarks)
    pose/matcher.ts            Torso-normalized cosine-similarity matcher
    overlay/PoseOverlay.tsx    Canvas overlay (template + live skeleton)
    backend/client.ts          Throttled guidance client
    App.tsx / App.css          App composition + styles
  vite.config.ts               /api + /health proxy in dev
```
