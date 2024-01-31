import React, { useCallback } from 'react';
import { Card, IconButton } from 'react-native-paper';
import { useLiveQuery } from 'electric-sql/react';
import { useElectric } from './ElectricProvider';
import { View } from 'react-native';
import { Link } from 'expo-router';


const ShoppingListCard = ({
  shoppingListId,
  onPress
} : {
  shoppingListId: string,
  onPress?: () => void,
}) => {
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

  const onDeleted = useCallback(() => db.shopping_list.delete({
    where: {
      list_id: shoppingListId
    }
  }), [ shoppingListId ])

  if (!shoppingList) return null
  return (
    <Card mode="elevated" onPress={onPress}>
      <Card.Title
        title={shoppingList.title}
        subtitle={`Last updated: ${shoppingList.updated_at.toLocaleString()}`}
        right={(_) => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Link href={`shopping_list/${shoppingListId}/edit`} asChild>
              <IconButton icon="pencil" />
            </Link>
            <IconButton icon="trash-can" onPress={onDeleted} />
          </View>
          
        )}
      />
    </Card>
  )
}

export default ShoppingListCard;