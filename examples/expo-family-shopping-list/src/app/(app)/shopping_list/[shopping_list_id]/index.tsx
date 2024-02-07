import { useLiveQuery } from 'electric-sql/react';
import { Link, Redirect, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { FlatList, View } from 'react-native';
import { FAB, List, Appbar, Text, Button } from 'react-native-paper';

import { useElectric } from '../../../../components/ElectricProvider';
import FlatListSeparator from '../../../../components/FlatListSeparator';
import ShoppingListItemCard from '../../../../components/ShoppingListItemCard';

export default function ShoppingListItems() {
  const { shopping_list_id } = useLocalSearchParams<{ shopping_list_id: string }>();
  if (shopping_list_id === undefined) {
    return <Redirect href="/" />;
  }

  const { db } = useElectric()!;
  const { results: { title } = {} } = useLiveQuery<{ title: string }>(
    db.shopping_list.liveUnique({
      select: {
        title: true,
      },
      where: {
        list_id: shopping_list_id,
      },
    }),
  );

  const { results: shopping_list_items = [] } = useLiveQuery(
    db.shopping_list_item.liveMany({
      select: {
        item_id: true,
      },
      where: {
        list_id: shopping_list_id,
      },
      orderBy: {
        updated_at: 'asc',
      },
    }),
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerTitle: title,
          headerRight: () => (
            <Link href={`shopping_list/${shopping_list_id}/edit`} asChild>
              <Appbar.Action icon="pencil" />
            </Link>
          ),
        }}
      />
      <List.Section style={{ flex: 1 }}>
        <List.Subheader>Items</List.Subheader>
        {shopping_list_items.length > 0 ? (
          <FlatList
            contentContainerStyle={{ padding: 6 }}
            data={shopping_list_items}
            ItemSeparatorComponent={() => <FlatListSeparator />}
            renderItem={(item) => <ShoppingListItemCard shoppingListItemId={item.item.item_id} />}
            keyExtractor={(item) => item.item_id}
          />
        ) : (
          <View style={{ flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Text variant="bodyLarge">No items in this shopping list</Text>
            <Link href={`shopping_list/${shopping_list_id}/item/add`} asChild>
              <Button mode="contained">Add item</Button>
            </Link>
          </View>
        )}
      </List.Section>
      <Link
        style={{
          position: 'absolute',
          marginBottom: 16,
          right: 0,
          bottom: 0,
        }}
        href={`shopping_list/${shopping_list_id}/item/add`}
        asChild>
        <FAB icon="plus" />
      </Link>
    </View>
  );
}
