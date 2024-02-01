import { useLiveQuery } from 'electric-sql/react'
import React from 'react'
import { FlatList, SafeAreaView, View } from 'react-native'
import { List, FAB, Text } from 'react-native-paper'
import { useElectric } from '../../../components/ElectricProvider'
import ShoppingListCard from '../../../components/ShoppingListCard'
import { Link } from 'expo-router'
import FlatListSeparator from '../../../components/FlatListSeparator'

export default function ShoppingLists () {
  const { db } = useElectric()!
  const { results: shopping_lists = [] } = useLiveQuery(db.shopping_list.liveMany({
    select: {
      list_id: true
    },
    orderBy: {
      updated_at: 'desc',
    }
  }))

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <List.Section style={{ flex: 1 }}>
          <List.Subheader>Your Shopping Lists</List.Subheader>
          { shopping_lists.length > 0 ?
            <FlatList
            style={{ padding: 6 }}
            data={shopping_lists}
            renderItem={(item) => (
              <Link href={`/shopping_list/${item.item.list_id}`} asChild>
                <ShoppingListCard shoppingListId={item.item.list_id} />
              </Link>
            )}
            ItemSeparatorComponent={() => <FlatListSeparator />}
            keyExtractor={(item) => item.list_id}
            />
            :
            <View style={{ flexDirection:'column', alignItems: 'center' }}>
              <Text variant="bodyLarge">No shopping lists</Text>
            </View>
          }
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