import { useLiveQuery } from 'electric-sql/react'
import React from 'react'
import {
  Button,
  FlatList,
  Text,
  TouchableOpacity,
  View
} from 'react-native'
import { useElectric } from '../../../components/ElectricProvider'
import { genUUID } from 'electric-sql/util'
import ShoppingListCard from '../../../components/ShoppingListCard'
import { Link } from 'expo-router'

export default function Home () {
  const { db } = useElectric()!
  const { results=[], error } = useLiveQuery(db.shopping_list.liveMany({
    select: {
      list_id: true
    },
    orderBy: {
      updated_at: 'desc',
    }
  }))


  const createShoppingList = async () => db.shopping_list.create({
    data: {
      list_id: genUUID(),
      family_id: (await db.family.findFirst()).family_id,
      created_at: new Date(),
      updated_at: new Date(),
      title: 'New list'
    }
  })

  return (
    <View>
      <Button onPress={createShoppingList} title='Create shopping list' />
      <FlatList
        data={results}
        renderItem={(item) => (
          <Link href={`/shopping_list/${item.item.list_id}`} asChild>
            <TouchableOpacity>
              <ShoppingListCard shoppingListId={item.item.list_id} />
            </TouchableOpacity>
          </Link>
        )}
        keyExtractor={(item) => item.list_id}
        />
    </View>
  )
}