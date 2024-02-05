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
    user_name: inviteeUserName = 'Unknown name'
  } = useLocalSearchParams<InviteParams>()
  const [ selectedFamilyId, setSelectedFamilyId ] = useState(queryTargetFamilyId)
  const userId = useAuthenticatedUser()!
  const { db } = useElectric()!

  // fallback to inviting to default family if none is specified,
  // such as in the case of inviting someone through a link they
  // provided that contains their user ID and name
  useEffect(() => {
    if (!selectedFamilyId) {
      db.family.findFirst({ where: { creator_user_id: userId }})
        .then((family) => setSelectedFamilyId(family.family_id))
    }
  }, [selectedFamilyId, userId])


  // create membership for invitee user in target family
  const handleInvite = async () => {
    if (!inviteeUserId || !selectedFamilyId) return
    await db.member.create({
      data: {
        user_id: inviteeUserId,
        family_id: selectedFamilyId,
        member_id: genUUID(),
        name: inviteeUserName,
        created_at: new Date()
      }
    })
    router.back()
  }

  const handleDismiss = () => router.back()


  // if no user ID to invite is provided, invite cannot happen
  if (!inviteeUserId) return <Redirect href="../" />
  if (!selectedFamilyId) return
  return (
    <View>
      <TextInput
        mode="outlined"
        value={inviteeUserName}
        readOnly
      />
      <FamilyDropDown
        selectedFamilyId={selectedFamilyId}
        onChange={setSelectedFamilyId}
        disabled={queryTargetFamilyId !== undefined}
      />
      <View>
        <Button mode="contained-tonal" onPress={handleDismiss}>
          Cancel
        </Button>
        <Button mode="contained" onPress={handleInvite}>
          Invite
        </Button>
      </View>
    </View>
  )
}