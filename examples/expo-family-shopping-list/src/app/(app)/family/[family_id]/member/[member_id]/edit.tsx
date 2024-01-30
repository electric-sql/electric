import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { TextInput, Button } from 'react-native-paper'
import { useLiveQuery } from 'electric-sql/react'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useElectric } from '../../../../../../components/ElectricProvider'

export default function EditMember () {
  const { member_id } = useLocalSearchParams<{ member_id?: string }>()
  if (!member_id) return <Redirect href="/families" />

  
  const [ name, setName ] = useState<string>()
  const { db } = useElectric()!
  const { results: member } = useLiveQuery(db.member.liveUnique({
    where: {
      member_id: member_id
    }
  }))

  useEffect(() => {
    if (name === undefined && member?.name !== undefined) {
      setName(member.name)
    }
  }, [member?.name])

  const onSubmit = useCallback(() => {
    if (!name) return
    db.member.update({
      data: {
        name: name
      },
      where: {
        member_id: member_id
      }
    })
    router.back()
  }, [name, member_id])

  if (!member) return null
  return (
    <View style={{ padding: 12, gap: 12 }}>
      <TextInput 
        error={!name}
        label="Name"
        value={name}
        onChangeText={setName}
        onSubmitEditing={onSubmit}
        />
      <Button mode="contained" disabled={!name} onPress={onSubmit}>
        Save
      </Button>
    </View>
  )
}

