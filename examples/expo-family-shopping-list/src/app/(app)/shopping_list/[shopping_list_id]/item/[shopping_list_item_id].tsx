import { useLocalSearchParams } from 'expo-router';
import React from 'react'
import {
  Text,
  View
} from 'react-native'

export default function ViewShoppingListItem () {
  const { shopping_list_item_id } = useLocalSearchParams();
  return (
    <View>
      <Text>View Shopping List Item ID: {shopping_list_item_id}</Text>
    </View>
  )
}