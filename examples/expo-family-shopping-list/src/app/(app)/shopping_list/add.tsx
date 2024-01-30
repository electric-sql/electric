import React, { useState } from 'react'
import {
  Button,
  View
} from 'react-native'
import ShoppingListEditor, { ShoppingListProperties } from '../../../components/ShoppingListEditor'
import { useElectric } from '../../../components/ElectricProvider'
import { genUUID } from 'electric-sql/util'
import { router } from 'expo-router';


export default function AddShoppingListItem () {
  const [ props, setProps ] = useState<ShoppingListProperties>()

  const { db } = useElectric()!
  const onCreate = async () => {
    const newListId = genUUID()
    await db.shopping_list.create({
      data: {
        list_id: newListId,
        family_id: (await db.family.findFirst()).family_id,
        title: props?.title ?? 'Untitled',
        updated_at: new Date(),
        created_at: new Date(),
      }
    })
    router.replace(`/shopping_list/${newListId}`)
  }
  return (
    <View>
      <ShoppingListEditor onChange={setProps} />
      <Button onPress={onCreate} title="Create" />
    </View>
  )
}