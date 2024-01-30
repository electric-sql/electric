import React, { useCallback } from 'react';
import { List, Checkbox, IconButton } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';
import { View } from 'react-native';


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
  return <List.Item
    title={item.name}
    description={`Last updated: ${item.updated_at.toLocaleString()}`}
    right={(_) =>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Checkbox.Android
          status={item.completed ? 'checked' : 'unchecked'}
          onPress={onChecked}
        />
        <IconButton icon="trash-can" onPress={onDeleted} />
      </View>
    }
  />
}


export default ShoppingListItemCard;