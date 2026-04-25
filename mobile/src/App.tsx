import { Pressable, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useCameraPermission } from './camera/useCameraPermission'
import { CameraScreen } from './screens/CameraScreen'

/**
 * Root: camera-permission state machine. Mirrors the web app states exactly:
 *   idle       -> prompt the user to grant
 *   granted    -> render the live camera screen
 *   denied     -> banner + retry
 *   unavailable-> banner (no front camera found)
 */
export default function App() {
  const { status, request, device } = useCameraPermission()

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {status === 'idle' && (
        <CenteredMessage
          title="Live pose outline"
          body="Grant camera access to start the live pose overlay."
          actionLabel="Allow camera"
          onAction={request}
        />
      )}
      {status === 'denied' && (
        <CenteredMessage
          title="Camera access denied"
          body="Enable camera access in your phone's settings and try again."
          actionLabel="Try again"
          onAction={request}
        />
      )}
      {status === 'unavailable' && (
        <CenteredMessage
          title="No front camera available"
          body="This device does not have a front-facing camera we can use."
        />
      )}
      {status === 'granted' && device && <CameraScreen device={device} />}
    </View>
  )
}

function CenteredMessage({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string
  body: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.btnText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  title: { color: '#f1f5f9', fontSize: 22, fontWeight: '700' },
  body: { color: '#cbd5f5', fontSize: 16, textAlign: 'center', maxWidth: 360 },
  btn: {
    marginTop: 12,
    backgroundColor: '#38bdf8',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  btnText: { color: '#0f172a', fontSize: 16, fontWeight: '700' },
})
