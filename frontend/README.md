# frame-mog — frontend (React + Vite + MediaPipe)

See the repo root [`README.md`](../README.md) for product context and
architecture.

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

Opens at [http://localhost:5173](http://localhost:5173). Dev server
proxies `/api` and `/health` to `http://localhost:8000`, so start the
backend (`cd ../backend && uv run uvicorn app.main:app --reload`) first
for full agent output. Without it, the app still renders the live
MediaPipe overlay using local template matching.

## Scripts

```bash
bun run dev       # dev server
bun run build     # tsc -b && vite build
bun run lint      # eslint .
bun run preview   # preview the production bundle
```

## Source layout

```
src/
  camera/useCamera.ts            Camera permission state machine
  pose/mediapipe.ts              PoseLandmarker factory + constants
  pose/usePoseLandmarker.ts      rAF detection loop
  pose/templates.ts              5 predefined templates
  pose/matcher.ts                Cosine-similarity template matcher
  overlay/PoseOverlay.tsx        Canvas overlay renderer
  backend/client.ts              Throttled guidance client
  App.tsx / App.css              App shell + HUD
```

## Environment

`VITE_BACKEND_URL` (optional) overrides the backend base URL. In dev leave
it unset so the Vite proxy handles routing.
