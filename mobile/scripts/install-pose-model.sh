#!/usr/bin/env bash
# Downloads Google's MediaPipe `pose_landmarker_lite.task` model (~5 MB) into
# mobile/assets/models/. The `react-native-mediapipe-posedetection` Expo
# config plugin then copies it into the native iOS + Android projects the next
# time you run `expo prebuild` (or `expo run:android` / `expo run:ios`).
#
# Usage (run once; re-run after bumping the model):
#   cd mobile
#   bash scripts/install-pose-model.sh
set -euo pipefail

MODEL_URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
MODEL_NAME="pose_landmarker_lite.task"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT_DIR/assets/models/$MODEL_NAME"

mkdir -p "$(dirname "$DEST")"

if [[ -f "$DEST" ]]; then
  echo "[install-pose-model] Using cached $DEST"
else
  echo "[install-pose-model] Downloading $MODEL_NAME..."
  curl -fSL --retry 3 "$MODEL_URL" -o "$DEST"
fi

echo "[install-pose-model] Ready at $DEST"
echo "[install-pose-model] Next: run 'npx expo prebuild' (if you haven't already)"
echo "                     so the config plugin copies it into android/ and ios/."
