import { useLocalSearchParams } from 'expo-router';
import React from 'react'
import {
  Text,
  View
} from 'react-native'

export default function ShoppingListItems () {
  const { slug } = useLocalSearchParams();
  return (
    <View>
      <Text>Shopping List ID: {slug}</Text>
    </View>
  )
}