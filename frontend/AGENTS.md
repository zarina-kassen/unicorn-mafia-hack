# AGENTS.md — frontend (React + Vite + TypeScript)

Instructions for AI agents working in the `frontend/` directory.

## Stack

- **React 19** with functional components and hooks.
- **TypeScript 6** (strict, `es2023` target, `noUnusedLocals`, `noUnusedParameters`).
- **Vite 8** as the bundler and dev server.
- **bun** as the package manager and script runner.
- **ESLint** with `typescript-eslint`, `react-hooks`, and `react-refresh` plugins.
- **Clerk** (`@clerk/react`) for authentication.
- **TanStack React Query** for async state management.
- **MediaPipe Tasks Vision** for in-browser pose detection.

## Key files

```
src/
├── App.tsx                  # Main component — camera, pose matching, UI state
├── main.tsx                 # React root: ClerkProvider + QueryClientProvider
├── App.css / index.css      # Global styles
├── pose/
│   ├── mediapipe.ts         # MediaPipe type re-exports
│   ├── usePoseLandmarker.ts # Hook: loads PoseLandmarker, runs detectForVideo in rAF loop
│   ├── matcher.ts           # Torso-normalized cosine-similarity template matching
│   ├── templates.ts         # Landmark geometry for the five predefined poses
│   └── galleryTargets.ts    # Gallery pose metadata (title, instruction, image)
├── overlay/
│   └── PoseOverlay.tsx      # Canvas component: draws live + target skeletons
├── camera/
│   └── useCamera.ts         # getUserMedia hook with state machine
├── backend/
│   └── client.ts            # Throttled fetch client for /api/guidance calls
├── api/
│   ├── client.ts            # Typed API client
│   ├── guidance.ts          # Guidance-specific API helpers
│   └── types.ts             # Shared API types
└── hooks/
    └── useGuidance.ts       # Hook wrapping guidance API with React Query
```

## Commands

```sh
# Run from the frontend/ directory

# Install dependencies
bun install

# Start dev server (port 5173, proxies /api → localhost:8000)
bun run dev

# Lint (ESLint)
bun run lint

# Build (TypeScript type-check + Vite production build)
bun run build

# Preview production build
bun run preview
```

## Code conventions

### TypeScript

- Use `import type { X }` for type-only imports — enforced by `verbatimModuleSyntax`.
- Prefer `interface` for object shapes, `type` for unions and computed types.
- No `any`, `@ts-ignore`, or `as unknown as X` — fix the types properly.
- Target is `es2023` — modern syntax (`??`, `?.`, `using`, etc.) is fine.

### React

- Functional components only — no class components.
- Hooks must follow the Rules of Hooks; the `react-hooks` ESLint plugin enforces this.
- Prefix custom hooks with `use` (e.g., `useCamera`, `usePoseLandmarker`).
- Use `useCallback` and `useMemo` where dependencies are non-trivial.
- State shape types go in the component file or in `api/types.ts` if shared.
- Wrap the app tree with `ClerkProvider` and `QueryClientProvider` (see `main.tsx`).

### Styling

- Global styles in `App.css` and `index.css` — no CSS-in-JS or CSS modules yet.
- Keep styling minimal; the app is a full-screen camera overlay.

### API calls

- Use the throttled client in `backend/client.ts` for guidance requests —
  it enforces a ~1.5 s minimum interval and aborts stale in-flight requests.
- Use `getToken()` from `useAuth()` for Clerk bearer tokens on API calls.
- Backend URL is configured via `VITE_BACKEND_URL`; defaults to empty string
  so the Vite proxy (`/api → localhost:8000`) handles routing in dev.

### MediaPipe

- MediaPipe runs entirely in the browser via WASM + `pose_landmarker_lite`.
- The `usePoseLandmarker` hook manages the model lifecycle and rAF detection loop.
- Landmarks are 33 normalized 2D/3D coordinates — see `mediapipe.ts` for types.
- The overlay (`PoseOverlay.tsx`) renders on a `<canvas>` overlaid on `<video>` —
  it redraws every frame and must never block on the network.

## Architecture constraints

- **No ML on the backend** — MediaPipe pose detection is browser-only.
- **No raw frames leave the browser** — only landmarks + metadata are sent.
- The overlay must render independently of backend responses. Backend guidance
  is supplementary and arrives asynchronously.
- Template matching (`matcher.ts`) uses torso-normalized cosine similarity
  over 10 key joints. Templates are a fixed set of five poses defined in
  `templates.ts`.

## Environment variables

| Variable                     | Purpose                            |
|------------------------------|------------------------------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk frontend publishable key     |
| `VITE_BACKEND_URL`           | Backend base URL (empty for proxy) |

Both must be prefixed with `VITE_` to be exposed to the client bundle.

## Do

- Keep the rAF loop lean — avoid allocations and DOM reads in the hot path.
- Add new hooks under `hooks/` or a relevant feature directory.
- Add new API types to `api/types.ts`.
- Test changes with `bun run build` — it runs `tsc -b` and catches type errors.

## Don't

- Don't import backend-only packages (FastAPI, Pydantic, etc.).
- Don't add heavy runtime dependencies without justification.
- Don't modify `bun.lock` manually — use `bun add <package>`.
- Don't block the camera overlay on network requests.
- Don't send raw video/image data to the backend.
- Don't hard-code Clerk keys — use `VITE_CLERK_PUBLISHABLE_KEY` env var.
- Don't break the Vite proxy config in `vite.config.ts` — the frontend
  relies on `/api`, `/generated`, and `/health` being proxied to port 8000.
