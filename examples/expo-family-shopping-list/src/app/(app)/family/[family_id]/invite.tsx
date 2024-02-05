import React, { useEffect } from 'react'
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera/next'

import { View } from 'react-native'
import { Button, Text } from 'react-native-paper'
import * as Linking from 'expo-linking'
import { router, useLocalSearchParams } from 'expo-router'
import { parseToInternalInviteUrl } from '../../../../lib/invite'

export default function FamilyInvite () {
  const { family_id } = useLocalSearchParams<{ family_id: string }>()
  const [ permission, requestPermission ] = useCameraPermissions();
  const { granted = false, canAskAgain = false } = permission ?? {}

  const onPermissionRequest = () => {
    if (canAskAgain) return requestPermission()
    else Linking.openSettings()
  }

  const onBarcodeScanned = (result: BarcodeScanningResult) => {
    try {
      const localHref = parseToInternalInviteUrl(result.data, family_id)
      router.replace(localHref)
    } catch (err) {
      console.warn(`Ignoring parsed QR code: ${result.data}`)
    }
  }

  // request permissions immediately if possible
  useEffect(() => {
    if (!granted && canAskAgain) requestPermission()
  }, [granted, canAskAgain])
  
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 16}}>
      <Text variant="bodyMedium">
        Scan the QR code of the person you wish to invite to your family,
        which they can find in their side menu under
        <Text style={{ fontWeight: "bold" }}> Join a Family.</Text>
      </Text>
      { granted ?
        <View style={{ flexDirection: 'row' }}>
          <CameraView
            style={{ flex: 1, aspectRatio: 1 }}
            barcodeScannerSettings={{
              barCodeTypes: ["qr"],
            }}
            onBarcodeScanned={onBarcodeScanned}
            />
        </View>
        :
        <Button mode="contained-tonal" onPress={onPermissionRequest}>
          Grant access to camera
        </Button>
      }
    </View>
  )
}