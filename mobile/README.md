# mobile — Live Pose Outline (Expo)

React Native + Expo app that runs **Google MediaPipe Pose Landmarker** on-device and overlays a live pose-guide on top of the camera preview. Calls the FastAPI backend at `/api/guidance` every ~1.5 s for higher-level guidance text.

This app **cannot run in Expo Go** — it ships custom native modules (VisionCamera + MediaPipe Tasks + Skia + worklets-core). You need a **development build** (Expo dev client).

## Quick start (Android, free — no Apple account required)

```bash
cd mobile

# 1. Install JS deps
npm install

# 2. Download the MediaPipe pose model (~5 MB) into assets/models/.
bash scripts/install-pose-model.sh

# 3. Generate native projects. The config plugin auto-copies the model into
#    android/app/src/main/assets and the iOS project during prebuild.
npx expo prebuild

# 4. Point the app at your backend (LAN IP of the machine running uvicorn).
cp .env.example .env
# edit .env and set EXPO_PUBLIC_API_BASE_URL, e.g. http://192.168.1.42:8000

# 5. Build a development APK and install it on your phone.
#    Plug your Android phone into USB with USB debugging enabled, then:
npx expo run:android
#    (or, for cloud builds that yield an install-by-QR link:)
#    npx eas build --profile development --platform android

# 6. Start the Metro bundler for hot-reload. Open the installed app, and it
#    auto-connects.
npx expo start --dev-client
```

## iOS

Same flow, but building for a real iPhone requires a **paid Apple Developer account** for device provisioning:

```bash
npx expo run:ios                                       # requires macOS + Xcode
# or:
npx eas build --profile development --platform ios     # cloud; paid account
```

For Xcode simulator only (free):

```bash
npx eas build --profile development-simulator --platform ios
```

## Why not Expo Go

Expo Go is immutable — it only contains the native modules the Expo team ships. This app needs:

- [`react-native-vision-camera`](https://github.com/mrousavy/react-native-vision-camera) — camera + frame processors.
- [`react-native-worklets-core`](https://github.com/margelo/react-native-worklets-core) — JS worklets required by the frame processor.
- [`react-native-mediapipe-posedetection`](https://github.com/EndLess728/react-native-mediapipe-posedetection) — thin Swift/Kotlin wrapper around Google's MediaPipe Tasks Vision PoseLandmarker. GPU delegate by default, 33 landmarks, ~15 fps auto-throttled.
- [`@shopify/react-native-skia`](https://github.com/Shopify/react-native-skia) — GPU canvas for smooth overlay rendering.
- `expo-dev-client` — the dev-client library that lets the custom build talk to the Metro bundler.

## Project layout

```
mobile/
  app.config.ts          Expo config (camera permission strings, New Architecture, plugins)
  eas.json               EAS Build profiles (development / development-simulator / preview)
  babel.config.js        worklets-core + reanimated plugins
  tsconfig.json          extends expo/tsconfig.base, strict on
  index.ts               Expo root registration
  scripts/install-pose-model.sh
                         Downloads pose_landmarker_lite.task and copies it into
                         android/app/src/main/assets and the iOS project dir.
  src/
    App.tsx              Permission state machine (idle / granted / denied / unavailable)
    camera/useCameraPermission.ts
    pose/landmarkIndices.ts  LM indices + POSE_CONNECTIONS + NormalizedLandmark
    pose/templates.ts        5 pose templates (ported from web MVP)
    pose/matcher.ts          Torso-normalized cosine similarity (ported from web MVP)
    pose/usePose.ts          Hook: MediaPipe PoseLandmarker via VisionCamera plugin
    overlay/PoseOverlay.tsx  Skia canvas: target + live skeletons
    backend/client.ts        Throttled (1.5 s) + abortable /api/guidance client
    screens/CameraScreen.tsx Composes Camera + PoseOverlay + HUD + backend client
    config.ts                Reads EXPO_PUBLIC_API_BASE_URL (falls back to expo extra)
    types.ts                 Shared PoseContextPayload + GuidanceResponse
```

## Architecture (mirrors the web MVP)

1. VisionCamera pushes frames off the UI thread.
2. The MediaPipe plugin runs PoseLandmarker on the GPU and yields 33 landmarks per frame at ~15 fps.
3. `usePose` delivers landmarks to `CameraScreen` on the JS thread.
4. `CameraScreen` runs the matcher **locally** and renders the Skia overlay immediately — overlay never waits on the network.
5. Every ≥1.5 s, the throttled backend client posts `PoseContext` to `/api/guidance` and updates the HUD when a `GuidanceResponse` comes back.

If the backend is unreachable (airplane mode, wrong LAN IP, etc.), the overlay and local matching keep working — only the backend-generated guidance is missing, and the HUD falls back to the selected template's own guidance string.

## Troubleshooting

- **"Pose model not found" at runtime** — run `bash scripts/install-pose-model.sh` then re-run `npx expo prebuild` so the config plugin copies the model into the native projects.
- **Device can't reach backend** — phone and dev machine must be on the same Wi-Fi and client isolation must be off. Test with `curl http://<LAN-IP>:8000/health` from a terminal on another device on the same network.
- **Emulator can't reach backend** — Android emulator uses `http://10.0.2.2:8000`; iOS simulator uses `http://localhost:8000`.
- **Camera preview is black** — either permission wasn't granted (reopen app and accept), or the dev client is built against an older VisionCamera version than Metro is serving (rebuild with `eas build`).
- **JS thread freezes / OOM** — the plugin is throttled to 15 fps by default. If you bump the FPS, expect memory pressure on low-end phones.

## Limitations (MVP)

- No photo capture button yet — the experience is the live overlay.
- Front camera only.
- 5 static templates; no dynamic template generation.
- No retry/backoff on the backend client — it silently skips a cycle on failure.

## Next steps

- Add a shutter that snaps once the live pose matches the target ≥ 0.85 for N frames.
- Template editor (save your own poses).
- Settings screen for backend URL + debug landmarks toggle.
- Offline caching of the last few `GuidanceResponse` values so the HUD doesn't flicker on transient network blips.
