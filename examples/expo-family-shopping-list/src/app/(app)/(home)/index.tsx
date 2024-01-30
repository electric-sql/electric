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

  return (
    <View>
      <Link href="/shopping_list/add" asChild>
        <Button title='Create shopping list' />
      </Link>
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