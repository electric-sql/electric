import React, { useEffect, useState } from 'react'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import FamilyDropDown from '../../components/FamilyDropDown'
import { useElectric } from '../../components/ElectricProvider'
import { useAuthenticatedUser } from '../../components/AuthProvider'
import { Button, TextInput } from 'react-native-paper'
import { genUUID } from 'electric-sql/util'

interface InviteParams extends Record<string, string>{
  user_id: string,
  user_name: string,
  family_id: string
}

export default function Invite () {
  const {
    family_id: queryTargetFamilyId,
    user_id: inviteeUserId,
    user_name: inviteeUserName
  } = useLocalSearchParams<InviteParams>()
  const [ selectedFamilyId, setSelectedFamilyId ] = useState(queryTargetFamilyId)
  const [ memberName, setMemberName ] = useState(inviteeUserName)
  const userId = useAuthenticatedUser()!
  const { db } = useElectric()!

  const handleDismiss = () =>
    router.canGoBack() ?
    router.back() : router.replace('/')

  // create membership for invitee user in target family
  const handleInvite = async () => {
    if (!inviteeUserId || !selectedFamilyId || !memberName) return
    await db.member.create({
      data: {
        user_id: inviteeUserId,
        family_id: selectedFamilyId,
        member_id: genUUID(),
        name: memberName,
        created_at: new Date()
      }
    })
    handleDismiss()
  }

  // fallback to inviting to default family if none is specified,
  // such as in the case of inviting someone through a link they
  // provided that contains their user ID and name
  useEffect(() => {
    if (!inviteeUserId) return handleDismiss()

    if (!selectedFamilyId) {
      db.family.findFirst({ where: { creator_user_id: userId }})
        .then((family) => setSelectedFamilyId(family.family_id))
    }
  }, [selectedFamilyId, userId, inviteeUserId])


  if (!selectedFamilyId) return
  return (
    <View style={{ gap: 16 }}>
      <TextInput
        label="Member name"
        mode="outlined"
        autoFocus
        value={inviteeUserName}
        onChangeText={setMemberName}
        readOnly={inviteeUserName !== undefined}
      />
      <FamilyDropDown
        selectedFamilyId={selectedFamilyId}
        onChange={setSelectedFamilyId}
        disabled={queryTargetFamilyId !== undefined}
      />
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        <Button
          style={{ flex: 1 }}
          mode="contained-tonal"
          onPress={handleDismiss}>
          Cancel
        </Button>
        <Button
          style={{ flex: 1 }}
          mode="contained"
          disabled={!memberName || !selectedFamilyId}
          onPress={handleInvite}>
          Invite
        </Button>
      </View>
    </View>
  )
}