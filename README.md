# frame-mog — live pose coach

A smart camera web app: open it in the browser, grant camera access, and a
live pose guide helps you line up with target poses in real time—before you
capture. The team built Frame Mog for a 24-hour hackathon with real users on a
**production** deployment, not a localhost-only demo.

**Stack (high level):** React 19, Vite, and TypeScript on the client; **FastAPI**
and **Pydantic AI** on the backend; **Clerk** for auth; **Mubit** for
personalized taste memory; **OpenRouter** for LLM and **FLUX** image
generation; hosted on **Render** with **Devin** in the loop for continuous
integration and delivery.

## How Frame Mog Works

1. User opens the React web app in Chrome on any device — no app install required.
2. App requests camera permission. The live stream attaches to a `<video>` element instantly.
3. **MediaPipe** runs on-device, producing 33 body landmarks per frame directly in the browser — zero server round-trip, zero lag.
4. The frontend matches live landmarks against five pose templates (standing, hand on hip, seated, crossed legs, leaning) using a torso-normalised cosine-similarity matcher.
5. The closest matching template skeleton renders on a `<canvas>` overlay — the user sees both their live skeleton and the target pose outline simultaneously, so they know exactly how to adjust.
6. Every ~1.5 seconds, a lightweight pose context packet (landmarks, candidate template ID, confidence score, image size) is sent to the backend.
7. A **Pydantic AI** agent validates the input and returns a typed `GuidanceResponse` — recommended template, confidence score, short human-readable guidance tip, and flags for visibility, alignment, and whether to surface a different outline entirely.
8. The HUD updates live: pose name, confidence percentage, and coaching text. The overlay never blocks on the backend — guidance is an enhancement, not a dependency. Core experience stays instant even if the backend is slow.
9. When the user is happy with their position, they capture the frame. **FLUX** then generates multiple pose variant suggestions from that captured image — giving the user options to explore beyond the shot they just took.
10. **Mubit** logs every accepted and skipped pose across sessions, building a personal taste profile that makes future suggestions feel increasingly tailored to that specific user.
11. Saved images are handed to a **Devin** agent, which screens for quality, ranks by composition, and organises them into an optimal sequence — ready for one-tap LinkedIn posting or manual export.

For endpoint-level detail and environment variables, see
[`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md).

## Pydantic

Pydantic is the backbone of our image generation pipeline. Every pose request
is structured as a typed agent—defining the scene context, pose parameters, and
generation constraints before anything hits **FLUX** (via OpenRouter, e.g.
`FAST_IMAGE_MODEL`, default `black-forest-labs/flux.2-klein-4b`). This means
consistent, reliable outputs at every call. Without Pydantic the pipeline would
be unpredictable at scale. It is not an add-on; it is what makes the agent work.

## Render

Frame Mog was deployed on **Render** from early in the build and remained live
throughout the entire hackathon. Real users tested it, submitted photos, and
generated poses against a live production URL—not a localhost demo. Rather than
a traditional CI pipeline, we used a **Devin** agent as our CI: Devin monitored
changes, made the deployment decisions, and pushed updates to Render
automatically. This meant the team could keep building without stopping to
manage deployments. Render and Devin together acted as a fully autonomous
shipping pipeline throughout the 24 hours.

## Cognition (Devin)

Devin runs three distinct jobs in Frame Mog. First, it screens all
user-submitted photos and ranks them by pose quality and composition. Second,
it organises a user's saved images into an optimal sequence for social
posting—reasoning about narrative arc, not just individual image quality. Third,
it powers our **LinkedIn** auto-post feature, taking the ranked sequence and
preparing it for publishing. We ran this live during our in-hackathon photo
competition with real submissions.

## Mubit

Mubit is our personalisation moat. Every time a user accepts or skips a pose
suggestion, Mubit captures that as execution memory. It also analyses the
user's camera roll to understand their existing photo preferences. By session
three, recommendations feel personal—the agent already knows you prefer
standing poses, natural angles, and editorial framing. This is what turns Frame
Mog from a utility into a product people come back to.

## Image generation: FLUX, not GPT Image

Generated portraits and pose-variant images use **FLUX** on **OpenRouter**
(`FAST_IMAGE_MODEL`). We did **not** use GPT Image 2 (or similar) for that
step. Text planning and JSON outline/vision work use separate OpenRouter models
(see `AGENT_MODEL` and `POSE_GUIDE_MODEL` in `backend/.env.example`).

## Why we keep the camera on-device

Pose tracking and overlay drawing stay in the browser: low latency, no
per-frame cloud bill, and pixels for the live preview are not streamed to a
server for the overlay to work. The backend reasons over a small structured
summary (e.g. landmarks and metadata) on a throttled interval—see
`backend/.env` and `AGENT_MAX_TOKENS` / throttling in the client—so cost and
load stay bounded.

## How to run it locally

Requirements: Python 3.11+ with [uv](https://docs.astral.sh/uv/), and
[bun](https://bun.sh/) for the frontend. Copy `backend/.env.example` to
`backend/.env` and set at least `OPENROUTER_API_KEY`, `MUBIT_API_KEY`, and
`CLERK_*` to match your Clerk app. See
[`backend/README.md`](backend/README.md) for the full list.

```bash
cd backend && uv sync && uv run uvicorn app.main:app --reload
# other terminal
cd frontend && bun install && bun run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies
`/api` and related routes to the backend. Set `VITE_CLERK_PUBLISHABLE_KEY` in
`frontend` as needed (see [frontend README](frontend/README.md)).

```bash
cd backend  && uv run pytest -q
cd frontend && bun run lint && bun run build
```

## Architecture at a glance

```text
Browser (React, Clerk)
 ├── getUserMedia → <video>
 ├── client-side pose + template match                    ← real-time
 ├── canvas overlay (PoseOverlay)                        ← real-time
 └── throttled client ── POST /api/...  ──►  FastAPI
                                              ├── Pydantic AI (typed agents)
                                              ├── OpenRouter: LLM + FLUX (images)
                                              ├── Mubit (memory)
                                              └── memory / pose-variants / LinkedIn (as configured)
```

## Repo layout

```text
backend/     FastAPI, Pydantic AI, Mubit, pose variants, memory routes
frontend/    React, Vite, camera, pose UI, gallery, Clerk
.github/     CI workflows
```

See [AGENTS.md](AGENTS.md) for contributor conventions (including internal
module paths).
