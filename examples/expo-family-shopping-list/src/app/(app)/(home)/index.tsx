import { useLiveQuery } from 'electric-sql/react'
import React from 'react'
import { FlatList, View } from 'react-native'
import { List, FAB } from 'react-native-paper'
import { useElectric } from '../../../components/ElectricProvider'
import ShoppingListCard from '../../../components/ShoppingListCard'
import { Link } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function Home () {
  const { db } = useElectric()!
  const { results = [] } = useLiveQuery(db.shopping_list.liveMany({
    select: {
      list_id: true
    },
    orderBy: {
      updated_at: 'desc',
    }
  }))

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <List.Section style={{ flex: 1 }}>
          <List.Subheader>Shopping Lists</List.Subheader>
          <FlatList
            style={{ padding: 6 }}
            data={results}
            renderItem={(item) => (
              <Link href={`/shopping_list/${item.item.list_id}`} asChild>
                <ShoppingListCard shoppingListId={item.item.list_id} />
              </Link>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
            keyExtractor={(item) => item.list_id}
            />
        </List.Section>

        <Link
          style={{
            position: 'absolute',
            margin: 16,
            right: 0,
            bottom: 0,
          }}
          href="/shopping_list/add"
          asChild
        >
          <FAB icon="plus" />
        </Link>
      </View>
    </SafeAreaView>
  )
}