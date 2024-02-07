import { useLiveQuery } from 'electric-sql/react';
import { Link } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { FlatList, View } from 'react-native';
import { List, FAB, Text, Button } from 'react-native-paper';

import { useAuthenticatedUser } from '../../../components/AuthProvider';
import { useElectric } from '../../../components/ElectricProvider';
import FlatListSeparator from '../../../components/FlatListSeparator';
import ShoppingListCard from '../../../components/ShoppingListCard';

export default function ShoppingLists() {
  const userId = useAuthenticatedUser()!;
  const { db } = useElectric()!;
  const { results: memberships = [] } = useLiveQuery(
    db.member.liveMany({
      include: {
        family: {
          include: {
            shopping_list: {
              include: {
                family: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      where: {
        user_id: userId,
      },
    }),
  );

  const shoppingLists = useMemo(
    () =>
      memberships
        .reduce(
          (allLists, membership) => [...allLists, ...(membership.family?.shopping_list ?? [])],
          [],
        )
        .sort((a: any, b: any) => b.updated_at.getTime() - a.updated_at.getTime()),
    [memberships],
  );

  const onDeleted = useCallback(
    (listId: string) =>
      db.shopping_list.delete({
        where: { list_id: listId },
      }),
    [],
  );

  return (
    <View style={{ flex: 1 }}>
      <List.Section style={{ flex: 1 }}>
        <List.Subheader>Your Shopping Lists</List.Subheader>
        {shoppingLists.length > 0 ? (
          <FlatList
            contentContainerStyle={{ padding: 6 }}
            data={shoppingLists}
            renderItem={(item) => (
              <ShoppingListCard shoppingList={item.item} onDeleted={onDeleted} />
            )}
            ItemSeparatorComponent={() => <FlatListSeparator />}
            keyExtractor={(item) => item.list_id}
          />
        ) : (
          <View style={{ flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <Text variant="bodyLarge">No shopping lists</Text>
            <Link href="/shopping_list/add" asChild>
              <Button mode="contained">Create list</Button>
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
        href="/shopping_list/add"
        asChild>
        <FAB icon="plus" />
      </Link>
    </View>
  );
}
