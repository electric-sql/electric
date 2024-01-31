import React, { useCallback } from 'react'
import { View } from 'react-native'
import { useElectric } from '../../../../components/ElectricProvider'
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useLiveQuery } from 'electric-sql/react';
import FamilyEditor, { FamilyProperties } from '../../../../components/FamilyEditor';


export default function EditFamily() {
  const { family_id } = useLocalSearchParams<{ family_id: string}>()
  if (!family_id) return <Redirect href='../' />
  const { db } = useElectric()!
  const { results: { name } = {}} = useLiveQuery<{ name: string }>(db.family.liveUnique({
      select: {
        name: true
      },
      where: {
        family_id: family_id
      }
    }
  ))

  const onUpdate = useCallback(async (props: FamilyProperties) => {
    await db.family.update({
      data: {
        name: props.name,
      },
      where: {
        family_id: family_id
      }
    })
    router.back()
  }, [family_id])

  if (!name) return null  
  return (
    <View>
      <FamilyEditor
        initialName={name}
        onSubmit={onUpdate}
        submitText="Update"
      />
    </View>
  )
}