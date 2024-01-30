import React from 'react';
import { List } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';


const ShoppingListCard = ({ shoppingListId } : { shoppingListId: string }) => {
  const { db } = useElectric()!
  const { results: shoppingList } = useLiveQuery(db.shopping_list.liveUnique({
    include: {
      family: true,
      shopping_list_item: {
        select: {
          name: true
        }
      },
    },
    where: {
      list_id: shoppingListId
    }
  }))

  if (!shoppingList) return null

  return <List.Item
    title={shoppingList.title}
    description={`Last updated: ${shoppingList.updated_at.toLocaleString()}`}
  />
}

export default ShoppingListCard;