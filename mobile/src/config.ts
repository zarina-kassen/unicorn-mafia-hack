import Constants from 'expo-constants'

/**
 * Backend base URL for the FastAPI guidance agent.
 *
 * In dev, set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` to the LAN IP of the
 * machine running the backend, e.g. `http://192.168.1.42:8000`. On the device
 * this needs to be a reachable address, not `localhost` (which refers to the
 * device itself, not the dev machine).
 */
export const API_BASE_URL: string =
  (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ??
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  ''
