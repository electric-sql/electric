import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
  

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{shoppingList.title}</Text>
      <Text>Last Updated: {shoppingList.updated_at.toLocaleString()}</Text>
      <Text>Items: {shoppingList.shopping_list_item?.length ?? 0}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 16,
    margin: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
});


export default ShoppingListCard;