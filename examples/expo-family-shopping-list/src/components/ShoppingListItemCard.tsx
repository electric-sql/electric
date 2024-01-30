import React, { useCallback } from 'react';
import { List, Checkbox } from 'react-native-paper';
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

  if (!item) return null
  return <List.Item
    title={item.name}
    description={`Last updated: ${item.updated_at.toLocaleString()}`}
    right={(_) => 
      <Checkbox.Android
        status={item.completed ? 'checked' : 'unchecked'}
        onPress={onChecked}
      />
    }
  />
}


export default ShoppingListItemCard;