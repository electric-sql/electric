import React, { useMemo } from 'react'
import { View } from 'react-native'
import ShoppingListEditor, { ShoppingListProperties } from '../../../components/ShoppingListEditor'
import { useElectric } from '../../../components/ElectricProvider'
import { genUUID } from 'electric-sql/util'
import { router } from 'expo-router';
import { useLiveQuery } from 'electric-sql/react'
import { dummyUserId } from '../../../lib/auth'


export default function AddShoppingList() {
  const { db } = useElectric()!
  const { results: memberships = [] } = useLiveQuery(db.member.liveMany({
      include: {
        family: {
          select: {
            name: true,
          }
        }
      },
      where: {
        member_id: dummyUserId
      }
    }
  ))

  const onCreate = async (props: ShoppingListProperties) => {
    const newListId = genUUID()
    await db.shopping_list.create({
      data: {
        list_id: newListId,
        family_id: (await db.family.findFirst()).family_id,
        title: props.title,
        updated_at: new Date(),
        created_at: new Date(),
      }
    })
    router.replace(`/shopping_list/${newListId}`)
  }

  const familyOptions = useMemo(() => memberships.map((membership) => ({
    label: membership.family.name,
    value: membership.family_id
  })), [ memberships ])

  

  if (!familyOptions.length) return null
  return (
    <View>
      <ShoppingListEditor
        familyIdOptions={familyOptions}
        selectedFamilyId={familyOptions[0].value}
        onSubmit={onCreate}
        submitText="Create"
      />
    </View>
  )
}