import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{item.name}</Text>
      <Text>Last Updated: {item.updated_at.toLocaleString()}</Text>
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


export default ShoppingListItemCard;