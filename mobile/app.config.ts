import type { ExpoConfig } from 'expo/config'

/**
 * Expo config for the live pose-outline mobile app.
 *
 * Not Expo Go: uses custom native modules (VisionCamera + MediaPipe Tasks).
 * Build with `eas build --profile development` and open via `expo-dev-client`.
 */
const config: ExpoConfig = {
  name: 'Pose Outline',
  slug: 'pose-outline',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'poseoutline',
  newArchEnabled: true,
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0f172a',
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.devin.poseoutline',
    infoPlist: {
      NSCameraUsageDescription:
        'Pose Outline uses your camera to show a live pose-guide overlay while you compose a photo.',
    },
  },
  android: {
    package: 'dev.devin.poseoutline',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0f172a',
    },
    permissions: ['android.permission.CAMERA'],
  },
  plugins: [
    [
      'react-native-vision-camera',
      {
        cameraPermissionText:
          'Pose Outline needs camera access to show the live pose-guide overlay.',
        enableMicrophonePermission: false,
      },
    ],
    [
      'expo-build-properties',
      {
        ios: { deploymentTarget: '15.1' },
        android: { minSdkVersion: 24 },
      },
    ],
    [
      'react-native-mediapipe-posedetection',
      {
        // Bundles the downloaded .task model into the native projects during
        // `expo prebuild`. See scripts/install-pose-model.sh for the download.
        assetsPaths: ['./assets/models/'],
      },
    ],
  ],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? '',
  },
}

export default config
