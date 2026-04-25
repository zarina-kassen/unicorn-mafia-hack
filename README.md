# frame-mog — live pose outline camera (Expo)

A Huawei-style camera app: open it on your phone, grant camera access, and a
live pose-outline overlay appears on top of the preview so you can adjust your
posture **before** pressing the shutter. No "Take photo" step is needed for the
outline to show up — the experience is fully live.

This MVP has two pieces:

- **`mobile/`** — Expo (React Native + TypeScript). Runs Google MediaPipe
  PoseLandmarker on-device via `react-native-vision-camera` +
  `react-native-mediapipe-posedetection`, draws the overlay with
  `@shopify/react-native-skia`.
- **`backend/`** — FastAPI. Exposes a Pydantic AI agent that the app calls at
  a slow cadence (~every 1.5 s) for higher-level reasoning. The agent runs on
  **GPT-5.3** via the **Pydantic AI Gateway**.

The app **cannot run in Expo Go** — it ships custom native modules. You need a
development build (`eas build --profile development` or `expo run:android` /
`expo run:ios`). See [`mobile/README.md`](./mobile/README.md) for the exact
commands.

## How it works

1. User opens the Expo app. First launch prompts for camera permission.
2. VisionCamera streams frames off the JS thread.
3. `react-native-mediapipe-posedetection` runs MediaPipe's PoseLandmarker on
   the GPU (~15 fps auto-throttled) and yields 33 landmarks per frame.
4. The app matches live landmarks against five predefined templates
   (standing straight, hand on hip, seated, crossed legs, leaning) using a
   torso-normalized cosine-similarity matcher — locally, every frame.
5. A Skia `<Canvas>` draws the target skeleton (cyan) and the live skeleton
   (yellow) on top of the camera preview.
6. Every ≥ 1.5 s, a throttled client posts a lightweight `PoseContext`
   (landmarks + candidate template id + confidence) to
   `POST /api/guidance`.
7. The Pydantic AI agent returns a validated `GuidanceResponse`: recommended
   template, confidence, short guidance text, and flags for visibility /
   alignment / "suggest a different outline".
8. The HUD updates; the overlay itself never blocks on the backend.

## Why MediaPipe on-device

Landmark tracking is a perception task MediaPipe already solves deterministically
and in milliseconds. Running it on the phone's GPU:

- keeps it **fast** (≥ 15 fps, no network round trips in the hot path),
- keeps it **cheap** (no per-frame inference cost, no bandwidth),
- keeps it **private** (pixels never leave the device),
- keeps it **reliable** (works even when the backend is unreachable).

## Why the backend AI agent is for higher-level reasoning only

LLMs are slow and expensive at perception but great at reasoning over
pre-extracted context: which template fits the scene, whether the user is
aligned, whether to switch templates, and what natural-language cue to show.
`POST /api/guidance` does exactly that — takes the pose summary the app already
has and returns a typed `GuidanceResponse`. The overlay never waits on it.

## Why predefined templates beat AI-generated outlines

Asking an LLM to invent outline coordinates every frame would produce jittery
non-deterministic geometry, silently invalid poses, latency coupled to model
tail latency, and no way to A/B curated poses. A fixed library of five
designer-chosen templates sidesteps all of this. The agent's role is narrowed
to **picking which template to show** and **explaining what to adjust**, not to
drawing the outline itself.

## Run it locally

Requirements: Python 3.11+ with [uv](https://docs.astral.sh/uv/), Node.js 20+,
and — for installing the dev client on an Android phone — USB debugging
enabled (plus Xcode on macOS if you also want iOS).

### Backend

Create a Pydantic AI Gateway API key at
[logfire.pydantic.dev](https://logfire.pydantic.dev), attach an OpenAI upstream
provider to your org's gateway, then:

```bash
cd backend
cp .env.example .env
# edit .env and set PYDANTIC_AI_GATEWAY_API_KEY=pylf_v...
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0
```

The `--host 0.0.0.0` is important — the phone has to reach your dev machine
over Wi-Fi.

Endpoints:

- `GET  /health` — `{ "status": "ok", "model": "gateway/openai:gpt-5.3" }`
- `GET  /api/templates` — template metadata
- `POST /api/guidance` — `PoseContext` → `GuidanceResponse`

The agent uses `gateway/openai:gpt-5.3` by default; set `AGENT_MODEL` in `.env`
to any model string supported by Pydantic AI Gateway (e.g.
`gateway/anthropic:claude-sonnet-4-6`) to swap it out.

### Mobile

```bash
cd mobile

# 1. JS deps
npm install

# 2. Download the MediaPipe pose model (~5 MB) into assets/models/.
bash scripts/install-pose-model.sh

# 3. Generate native projects. The config plugin auto-copies the model into
#    android/ and ios/.
npx expo prebuild

# 4. Tell the app where the backend lives (LAN IP of your dev machine).
cp .env.example .env
# edit .env: EXPO_PUBLIC_API_BASE_URL=http://192.168.1.42:8000

# 5. Build + install a development build.
npx expo run:android        # phone plugged in via USB, debugging on
# or for iOS (macOS, Xcode, paid Apple account required):
# npx expo run:ios
# or a cloud build that produces an install-by-QR APK:
# npx eas build --profile development --platform android

# 6. Open the installed app. Metro auto-connects for hot-reload:
npx expo start --dev-client
```

See [`mobile/README.md`](./mobile/README.md) for the full setup, emulator
instructions, iOS simulator builds, and troubleshooting.

### Tests

```bash
cd backend && uv run pytest -q
cd mobile  && npx tsc --noEmit
```

## Current MVP limitations

- Single person, front-camera only.
- Templates are static 2-D front views; no side profiles or rotations.
- Cosine similarity normalizes by torso length but is not fully scale-invariant
  under extreme foreshortening.
- `snapshot_b64` is wired through the schema but unused by the text-only
  agent; a multimodal model is needed to make use of it.
- No auth / rate limiting / persistent logging on the backend.
- No shutter button yet — the whole product is the live overlay.

## Suggested next steps

- Snap-on-match shutter: auto-capture once the live pose matches the target ≥
  0.85 for N consecutive frames.
- Switch the agent to a multimodal model and feed the optional snapshot so it
  can comment on lighting and composition.
- Template variants per aspect ratio and auto-pick based on device orientation.
- Temporal smoothing (EMA) on confidence to avoid flicker when two templates
  score similarly.
- Settings screen for backend URL + debug landmarks toggle.

## Architecture at a glance

```
Phone (Expo dev client)
 ├── VisionCamera (off-UI-thread frame streaming)
 ├── MediaPipe PoseLandmarker (GPU delegate, ~15 fps)      ← real-time
 ├── matchTemplate(live, TEMPLATES)                         ← cosine similarity
 ├── Skia <Canvas> overlay                                  ← real-time
 └── GuidanceClient  ─── POST /api/guidance (~1.5 s) ──────┐
                                                            ▼
                                                     FastAPI
                                                     └── Pydantic AI Agent
                                                          └── gateway/openai:gpt-5.3
                                                               (via Pydantic AI Gateway)
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

mobile/
  app.config.ts                  Expo config (camera permissions, plugins)
  eas.json                       EAS Build profiles
  scripts/install-pose-model.sh  Downloads pose_landmarker_lite.task
  src/
    App.tsx                      Permission state machine
    camera/useCameraPermission.ts
    pose/landmarkIndices.ts      LM indices + POSE_CONNECTIONS
    pose/templates.ts            5 templates (ported from web MVP)
    pose/matcher.ts              Cosine-similarity matcher (ported)
    pose/usePose.ts              MediaPipe PoseLandmarker hook
    overlay/PoseOverlay.tsx      Skia canvas: target + live skeletons
    backend/client.ts            Throttled guidance client (ported)
    screens/CameraScreen.tsx     Camera + PoseOverlay + HUD + client
    config.ts                    Reads EXPO_PUBLIC_API_BASE_URL
    types.ts                     PoseContextPayload, GuidanceResponse
```
