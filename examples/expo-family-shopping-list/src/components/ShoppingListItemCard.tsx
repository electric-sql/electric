import deepEqual from 'deep-equal';
import { Link } from 'expo-router';
import React, { memo } from 'react';
import { View } from 'react-native';
import { Card, Checkbox, IconButton, Text } from 'react-native-paper';

import { Shopping_list_item } from '../generated/client';

const ShoppingListItemCard = ({
  item,
  onChecked,
  onDeleted,
}: {
  item: Shopping_list_item;
  onChecked: (itemId: string, checked: boolean) => void;
  onDeleted: (itemId: string) => void;
}) => {
  const handleChecked = () => onChecked(item.item_id, !item.completed);
  const handleDeleted = () => onDeleted(item.item_id);
  return (
    <Card mode="elevated" onPress={handleChecked}>
      {item.image_base_64 && <Card.Cover source={{ uri: item.image_base_64 }} />}
      <Card.Title
        title={`${item.name} ${item.quantity > 1 ? `×${item.quantity}` : ''}`}
        subtitle={`Added on: ${item.added_at.toLocaleString()}`}
        left={(_) => (
          <Checkbox.Android
            status={item.completed ? 'checked' : 'unchecked'}
            onPress={handleChecked}
          />
        )}
        right={(_) => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Link href={`shopping_list/${item.list_id}/item/${item.item_id}/edit`} asChild>
              <IconButton icon="pencil" />
            </Link>
            <IconButton icon="trash-can" onPress={handleDeleted} />
          </View>
        )}
      />
      {item.comment && (
        <Card.Content>
          <Text>{item.comment}</Text>
        </Card.Content>
      )}
    </Card>
  );
};

export default memo(ShoppingListItemCard, deepEqual);
