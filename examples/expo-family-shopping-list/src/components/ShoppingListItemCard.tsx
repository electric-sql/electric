import React, { useCallback } from 'react';
import { Card, Checkbox, IconButton, Text } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';

const ShoppingListItemCard = ({ shoppingListItemId } : { shoppingListItemId: string }) => {
  const { db } = useElectric()!
  const { results: item } = useLiveQuery(db.shopping_list_item.liveUnique({
    where: {
      item_id: shoppingListItemId
    }
  }))

  const onChecked = useCallback(() => db.shopping_list_item.update({
    data: {
      completed: !item.completed
    },
    where: {
      item_id: item.item_id
    }
  }), [ item ])

  const onDeleted = useCallback(() => db.shopping_list_item.delete({
    where: {
      item_id: item.item_id
    }
  }), [ item ])

  if (!item) return null
  return (
    <Card mode="elevated" onPress={onChecked}>
      <Card.Title
        title={`${item.name} ${item.quantity > 1 ? `×${item.quantity}` : ''}`}
        subtitle={`Added on: ${item.added_at.toLocaleString()}`}
        left={(_) => <Checkbox.Android
          status={item.completed ? 'checked' : 'unchecked'}
          onPress={onChecked}
        />}
        right={(_) => <IconButton icon="trash-can" onPress={onDeleted} />}
      />
      { item.comment &&
        <Card.Content>
          <Text>{item.comment}</Text>
        </Card.Content>
      }
    </Card>
  )
}


export default ShoppingListItemCard;