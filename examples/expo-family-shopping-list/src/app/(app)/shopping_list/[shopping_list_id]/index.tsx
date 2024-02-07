import { useLiveQuery } from 'electric-sql/react';
import { Link, Redirect, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback } from 'react';
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

  // retrieve the shopping list title for the header
  const { results: { title: shoppingListTitle } = {} } = useLiveQuery<{ title: string }>(
    db.shopping_list.liveUnique({
      select: {
        title: true,
      },
      where: {
        list_id: shopping_list_id,
      },
    }),
  );

  // retrieve all shopping list items for this list
  const { results: shoppingListItems = [] } = useLiveQuery(
    db.shopping_list_item.liveMany({
      where: {
        list_id: shopping_list_id,
      },
      orderBy: {
        updated_at: 'asc',
      },
    }),
  );

  // method for toggling item check status
  const onItemChecked = useCallback(
    (itemId: string, checked: boolean) =>
      db.shopping_list_item.update({
        data: { completed: checked },
        where: { item_id: itemId },
      }),
    [],
  );

  // method for deleting items
  const onItemDeleted = useCallback(
    (itemId: string) =>
      db.shopping_list_item.delete({
        where: { item_id: itemId },
      }),
    [],
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerTitle: shoppingListTitle,
          headerRight: () => (
            <Link href={`shopping_list/${shopping_list_id}/edit`} asChild>
              <Appbar.Action icon="pencil" />
            </Link>
          ),
        }}
      />
      <List.Section style={{ flex: 1 }}>
        <List.Subheader>Items</List.Subheader>
        {shoppingListItems.length > 0 ? (
          <FlatList
            contentContainerStyle={{ padding: 6 }}
            data={shoppingListItems}
            ItemSeparatorComponent={() => <FlatListSeparator />}
            renderItem={(item) => (
              <ShoppingListItemCard
                item={item.item}
                onDeleted={onItemDeleted}
                onChecked={onItemChecked}
              />
            )}
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
