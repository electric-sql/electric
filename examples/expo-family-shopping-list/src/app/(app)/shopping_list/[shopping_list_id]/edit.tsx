import React from 'react'
import { View } from 'react-native'
import ShoppingListEditor, { ShoppingListProperties } from '../../../../components/ShoppingListEditor'
import { useElectric } from '../../../../components/ElectricProvider'
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useLiveQuery } from 'electric-sql/react';


export default function AddShoppingList() {
  const { shopping_list_id } = useLocalSearchParams<{ shopping_list_id: string}>()
  if (!shopping_list_id) return <Redirect href='../' />
  const { db } = useElectric()!
  const { results: shoppingList } = useLiveQuery(
    db.shopping_list.liveUnique({
      include: {
        family: {
          select: {
            name: true 
          }
        }
      },
      where: {
        list_id: shopping_list_id
      }
    }
  ))

  const onUpdate = async (props: ShoppingListProperties) => {
    await db.shopping_list.update({
      data: {
        title: props.title,
        updated_at: new Date(),
      },
      where: {
        list_id: shopping_list_id
      }
    })
    router.back()
  }

  if (!shoppingList) return null  
  return (
    <View>
      <ShoppingListEditor
        initialTitle={shoppingList.title}
        familyIdOptions={[{ value: shoppingList.family_id!, label: shoppingList.family.name}]}
        selectedFamilyId={shoppingList.family_id}
        onSubmit={onUpdate}
        submitText="Update"
      />
    </View>
  )
}