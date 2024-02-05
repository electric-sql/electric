import React, { useMemo } from 'react'
import { Dimensions, Share, View } from 'react-native'
import QRCode from 'react-native-qrcode-svg';
import * as Linking from 'expo-linking';
import { useAuthenticatedUser } from '../../../components/AuthProvider'
import { Button, Text } from 'react-native-paper';
import { useElectric } from '../../../components/ElectricProvider';
import { useLiveQuery } from 'electric-sql/react';

const windowDimensions = Dimensions.get('window');

export default function PersonalCode () {
  const userId = useAuthenticatedUser()!
  const { db } = useElectric()!

  // select a name to initialize the membership in the new family
  const { results: { name } = {} } = useLiveQuery<{ name: string }>(
    db.member.liveFirst({
      select: { name: true },
      where: { user_id: userId }
    })
  )

  const joinFamilyLink = useMemo(() => Linking.createURL('/invite', {
    queryParams: {
      user_id: userId,
      user_name: name
    },
  }), [ userId, name ]);

  const shareLink = () => Share.share({
    title: 'I\'d like to join your family on Electric Shopping List!',
    url: joinFamilyLink,
  })

  return (
    <View style={{ flex: 1, alignItems: 'center', padding: 16, gap: 16 }}>
      <Text variant="titleLarge">
        How to use
      </Text>
      <Text variant="bodyMedium">
        Show this QR code or share the link below to another user,
        and they can make you part of their own family, allowing you
        to share shopping lists in real time.
      </Text>
      <View style={{ marginTop: 24 }}>
        <QRCode
          size={windowDimensions.width / 2}
          value={joinFamilyLink}
          logo={require('../../../../assets/icon.png')}
        />
      </View>
      <Button icon="share" onPress={shareLink}>
        Share
      </Button>
    </View>
  )
}
