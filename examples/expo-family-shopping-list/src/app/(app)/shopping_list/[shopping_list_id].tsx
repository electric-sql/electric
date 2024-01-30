import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react'
import {
  Button,
  FlatList,
  Pressable,
  Text,
  View
} from 'react-native'
import { useElectric } from '../../../components/ElectricProvider';
import { useLiveQuery } from 'electric-sql/react';
import { genUUID } from 'electric-sql/util';
import { TouchableOpacity } from 'react-native-gesture-handler';
import ShoppingListItemCard from '../../../components/ShoppingListItemCard';

export default function ShoppingListItems () {
  const { shopping_list_id } = useLocalSearchParams<{ shopping_list_id: string }>();
  if (shopping_list_id === undefined) {
    return <Redirect href="/" />
  }

  const { db } = useElectric()!
  const { results : shopping_list_items = [] } = useLiveQuery(db.shopping_list_item.liveMany({
    select: {
      item_id: true,
    },
    where: {
      list_id: shopping_list_id
    },
    orderBy: {
      updated_at: 'asc'
    }
  }))


  const createItem = async () => db.shopping_list_item.create({
    data: {
      item_id: genUUID(),
      list_id: shopping_list_id,
      added_at: new Date(),
      updated_at: new Date(),
      name: 'New item',
      quantity: 1,
      completed: false
    }
  })

  return (
    <View>
      <Text>Shopping List ID: {shopping_list_id}</Text>
      <Button onPress={createItem} title="Add item" />
      <FlatList
        data={shopping_list_items}
        renderItem={(item) => (
          <Link href={`/shopping_list_item/${item.item.item_id}`} asChild>
            <Pressable>
              <ShoppingListItemCard shoppingListItemId={item.item.item_id} />
            </Pressable>  
          </Link>
        )}
        keyExtractor={(item) => item.item_id}
        />
    </View>
  )
}