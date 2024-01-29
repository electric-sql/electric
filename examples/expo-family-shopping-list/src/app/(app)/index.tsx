import { useLiveQuery } from 'electric-sql/react'
import React from 'react'
import {
  Button,
  FlatList,
  Text,
  View
} from 'react-native'
import { useElectric } from '../../components/ElectricProvider'
import { genUUID } from 'electric-sql/util'

export default function Home () {
  const { db } = useElectric()!
  const { results } = useLiveQuery(db.shopping_list.liveMany({
    include: {
      shopping_list_item: {
        select: { name: true },
        take: 5
      }
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
      <Text>Shopping Lists</Text>
      <Button onPress={createShoppingList} title='Create' />
      <FlatList
        data={results}
        renderItem={(item) => <Text>{item.item.title}</Text>}
        keyExtractor={(item) => item.list_id}
        />
    </View>
  )
}