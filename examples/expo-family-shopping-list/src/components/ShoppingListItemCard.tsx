import React from 'react';
import { List } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';


const ShoppingListItemCard = ({ shoppingListItemId } : { shoppingListItemId: string }) => {
  const { db } = useElectric()!
  const { results: item } = useLiveQuery(db.shopping_list_item.liveUnique({
    where: {
      item_id: shoppingListItemId
    }
  }))

  if (!item) return null
  return <List.Item
    title={item.name}
    description={`Last updated: ${item.updated_at.toLocaleString()}`}
  />
}


export default ShoppingListItemCard;