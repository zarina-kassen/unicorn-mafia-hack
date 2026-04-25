import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Camera, type CameraDevice } from 'react-native-vision-camera'
import { PoseOverlay } from '../overlay/PoseOverlay'
import { createGuidanceClient } from '../backend/client'
import { usePose, type PoseResult } from '../pose/usePose'
import { matchTemplate } from '../pose/matcher'
import {
  TEMPLATES,
  getTemplate,
  type PoseTemplate,
} from '../pose/templates'
import type { NormalizedLandmark } from '../pose/landmarkIndices'
import type { GuidanceResponse, PoseContextPayload } from '../types'
import { API_BASE_URL } from '../config'

interface Props {
  device: CameraDevice
}

/**
 * Main camera screen: composes VisionCamera + MediaPipe frame processor +
 * Skia overlay + throttled backend client. The overlay never blocks on the
 * backend; backend guidance only drives the HUD text + target template.
 */
export function CameraScreen({ device }: Props) {
  const [paused, setPaused] = useState(false)
  const [live, setLive] = useState<NormalizedLandmark[] | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [guidance, setGuidance] = useState<GuidanceResponse | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)

  const onResult = useMemo(
    () => (r: PoseResult) => setLive(r.landmarks),
    [],
  )
  const { frameProcessor, onLayout: onPoseLayout } = usePose(onResult)

  const localMatch = useMemo(() => {
    if (!live) {
      return { template: TEMPLATES[0], score: 0, personVisible: false }
    }
    const m = matchTemplate(live, TEMPLATES)
    return { template: getTemplate(m.templateId), score: m.score, personVisible: m.personVisible }
  }, [live])

  const target: PoseTemplate = guidance
    ? getTemplate(guidance.recommended_template_id)
    : localMatch.template

  const clientRef = useRef(createGuidanceClient())
  useEffect(() => {
    const client = clientRef.current
    const unsub = client.subscribe((r) => {
      setGuidance(r)
      setBackendError(null)
    })
    return () => {
      unsub()
      client.stop()
    }
  }, [])

  useEffect(() => {
    if (!live || paused || !API_BASE_URL) return
    const payload: PoseContextPayload = {
      landmarks: live.map((lm) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z ?? 0,
        visibility: lm.visibility ?? 0,
      })),
      candidate_template_id: localMatch.template.id,
      local_confidence: localMatch.score,
      image_wh: [size.width || 0, size.height || 0],
    }
    clientRef.current.submit(payload)
  }, [live, localMatch, paused, size.width, size.height])

  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setSize({ width, height })
    onPoseLayout(e)
  }

  const confidenceText = localMatch.personVisible
    ? `${Math.round((guidance?.confidence ?? localMatch.score) * 100)}%`
    : '—'
  const guidanceText = guidance?.guidance ?? target.guidance
  const poseLabel = target.name

  return (
    <View style={styles.root} onLayout={handleLayout}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={!paused}
        frameProcessor={paused ? undefined : frameProcessor}
        pixelFormat="yuv"
      />
      <PoseOverlay
        width={size.width}
        height={size.height}
        template={target}
        live={paused ? null : live}
      />
      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.hudCard}>
          <Text style={styles.poseName}>{poseLabel}</Text>
          <Text style={styles.confidence}>Match: {confidenceText}</Text>
          <Text style={styles.guidance} numberOfLines={3}>
            {guidanceText}
          </Text>
          {backendError && <Text style={styles.error}>{backendError}</Text>}
        </View>
        <Pressable
          onPress={() => setPaused((p) => !p)}
          style={({ pressed }) => [
            styles.pauseBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.pauseText}>{paused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  hud: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 32,
    alignItems: 'center',
    gap: 16,
  },
  hudCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 16,
    marginHorizontal: 16,
    maxWidth: 420,
    alignSelf: 'stretch',
  },
  poseName: { color: '#f1f5f9', fontSize: 18, fontWeight: '600' },
  confidence: { color: '#cbd5f5', fontSize: 14, marginTop: 2 },
  guidance: { color: '#e2e8f0', fontSize: 15, marginTop: 8 },
  error: { color: '#fca5a5', fontSize: 12, marginTop: 8 },
  pauseBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
  },
  pauseText: { color: '#0f172a', fontSize: 16, fontWeight: '600' },
})
