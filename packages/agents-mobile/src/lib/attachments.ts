import { useCallback, useState } from 'react'
import { Alert, Linking, Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import type { NativeFileDescriptor } from '@electric-ax/agents-server-ui/src/lib/sendMessage'

/**
 * Image-attachment drafts for the composer, mirroring the desktop image-only
 * attachment policy. Holds picked images as `{ uri, name, type }` descriptors
 * that the shared `uploadMessageAttachments` serializes into multipart parts.
 */

// Compress when transcoding so a phone photo stays well under the server's
// 25 MB cap.
const IMAGE_QUALITY = 0.7

export type AttachmentDraft = NativeFileDescriptor

export type AttachmentDrafts = {
  drafts: Array<AttachmentDraft>
  addFromLibrary: () => Promise<void>
  addFromCamera: () => Promise<void>
  remove: (index: number) => void
  clear: () => void
  /** The native picker module is unavailable on the web build. */
  supported: boolean
}

async function toJpegDescriptor(
  asset: ImagePicker.ImagePickerAsset
): Promise<NativeFileDescriptor> {
  // Transcode to JPEG so iOS HEIC (and any other source format) becomes
  // something the agent's vision model accepts; also compresses for the cap.
  const result = await manipulateAsync(asset.uri, [], {
    compress: IMAGE_QUALITY,
    format: SaveFormat.JPEG,
  })
  const base = (
    asset.fileName ?? `image-${asset.assetId ?? Date.now()}`
  ).replace(/\.[^./]+$/, ``)
  return { uri: result.uri, name: `${base}.jpg`, type: `image/jpeg` }
}

// The OS shows the prompt itself on first ask; once it can no longer ask
// (permanent denial), guide the user to Settings so the picker isn't a no-op.
async function ensureGranted(
  request: () => Promise<{ granted: boolean; canAskAgain: boolean }>,
  deniedMessage: string
): Promise<boolean> {
  const permission = await request()
  if (permission.granted) return true
  if (!permission.canAskAgain) {
    Alert.alert(`Permission needed`, deniedMessage, [
      { text: `Cancel`, style: `cancel` },
      { text: `Open Settings`, onPress: () => void Linking.openSettings() },
    ])
  }
  return false
}

export function useAttachmentDrafts(): AttachmentDrafts {
  const [drafts, setDrafts] = useState<Array<AttachmentDraft>>([])

  const append = useCallback(
    async (result: ImagePicker.ImagePickerResult): Promise<void> => {
      if (result.canceled) return
      const descriptors = await Promise.all(result.assets.map(toJpegDescriptor))
      setDrafts((prev) => [...prev, ...descriptors])
    },
    []
  )

  const addFromLibrary = useCallback(async (): Promise<void> => {
    const granted = await ensureGranted(
      ImagePicker.requestMediaLibraryPermissionsAsync,
      `Enable photo access in Settings to attach images.`
    )
    if (!granted) return
    await append(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: [`images`],
        allowsMultipleSelection: true,
      })
    )
  }, [append])

  const addFromCamera = useCallback(async (): Promise<void> => {
    const granted = await ensureGranted(
      ImagePicker.requestCameraPermissionsAsync,
      `Enable camera access in Settings to take a photo.`
    )
    if (!granted) return
    await append(
      await ImagePicker.launchCameraAsync({ mediaTypes: [`images`] })
    )
  }, [append])

  const remove = useCallback((index: number): void => {
    setDrafts((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const clear = useCallback((): void => setDrafts([]), [])

  return {
    drafts,
    addFromLibrary,
    addFromCamera,
    remove,
    clear,
    supported: Platform.OS !== `web`,
  }
}
