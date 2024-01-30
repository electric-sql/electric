import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react'
import {
  Button,
  FlatList,
  Pressable,
  Text,
  View
} from 'react-native'
import { useElectric } from '../../../../components/ElectricProvider';
import { useLiveQuery } from 'electric-sql/react';
import { FAB, List } from 'react-native-paper';
import ShoppingListItemCard from '../../../../components/ShoppingListItemCard';
import { SafeAreaView } from 'react-native-safe-area-context';

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

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'right', 'left']}>
      <View style={{ flex: 1 }}>
        <List.Section style={{ flex: 1 }}>
          <List.Subheader>Items</List.Subheader>
          <FlatList
            data={shopping_list_items}
            ItemSeparatorComponent={() => <View style={{height: 20}} />}
            renderItem={(item) => (
              <Link href={`/shopping_list/${shopping_list_id}/item/${item.item.item_id}`} asChild>
                <Pressable>
                  <ShoppingListItemCard shoppingListItemId={item.item.item_id} />
                </Pressable>  
              </Link>
            )}
            keyExtractor={(item) => item.item_id}
            />
        </List.Section>
        <Link 
          style={{
            position: 'absolute',
            margin: 16,
            right: 0,
            bottom: 0,
          }}
          href={`shopping_list/${shopping_list_id}/item/add`} asChild>
          <FAB icon="plus" />
        </Link>
      </View>
    </SafeAreaView>
  )
}