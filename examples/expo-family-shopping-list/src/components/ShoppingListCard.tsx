import deepEqual from 'deep-equal';
import { Link, router } from 'expo-router';
import React, { memo } from 'react';
import { View } from 'react-native';
import { Card, IconButton, Text } from 'react-native-paper';

import { Family, Shopping_list } from '../generated/client';

interface ShoppingListWithFamily extends Shopping_list {
  family: Pick<Family, 'name'>;
}

const ShoppingListCard = ({
  shoppingList,
  onDeleted,
}: {
  shoppingList: ShoppingListWithFamily;
  onDeleted: (listId: string) => void;
}) => {
  const handleDeleted = () => onDeleted(shoppingList.list_id);
  const onCardPressed = () => router.push(`/shopping_list/${shoppingList.list_id}`);
  return (
    <Card mode="elevated" onPress={onCardPressed}>
      <Card.Title
        title={shoppingList.title}
        subtitle={`Last updated: ${shoppingList.updated_at.toLocaleString()}`}
        right={(_) => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Link href={`shopping_list/${shoppingList.list_id}/edit`} asChild>
              <IconButton icon="pencil" />
            </Link>
            <IconButton icon="trash-can" onPress={handleDeleted} />
          </View>
        )}
      />
      <Card.Content>
        <Text numberOfLines={1}>{`Shared with ${shoppingList.family.name}`}</Text>
      </Card.Content>
    </Card>
  );
};

export default memo(ShoppingListCard, deepEqual);
