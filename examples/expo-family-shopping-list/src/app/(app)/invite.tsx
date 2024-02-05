import React, { useEffect, useState } from 'react'
import { Redirect, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import FamilyDropDown from '../../components/FamilyDropDown'
import { useElectric } from '../../components/ElectricProvider'
import { useAuthenticatedUser } from '../../components/AuthProvider'


interface InviteParams extends Record<string, string>{
  user_id: string,
  user_name: string,
  family_id: string
}

export default function Invite () {
  const queryParams = useLocalSearchParams<InviteParams>()
  const [ selectedFamilyId, setSelectedFamilyId ] = useState(queryParams.family_id)
  const userId = useAuthenticatedUser()!
  const { db } = useElectric()!

  useEffect(() => {
    if (!selectedFamilyId) {
      db.family.findFirst({ where: { creator_user_id: userId }})
        .then((family) => setSelectedFamilyId(family.family_id))
    }
  }, [selectedFamilyId, userId])

  

  if (!selectedFamilyId) return
  return (
    <View>
      <FamilyDropDown
        selectedFamilyId={selectedFamilyId}
        onChange={setSelectedFamilyId}
      />
    </View>
  )
}