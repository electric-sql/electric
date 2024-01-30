import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{
      headerBackTitleVisible: false,
    }}>
      <Stack.Screen
        name="(home)"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="shopping_list/[shopping_list_id]/index"
      />
      <Stack.Screen
        name="shopping_list/add"
      />
      <Stack.Screen
        name="shopping_list/[shopping_list_id]/item/add"
      />
      <Stack.Screen
        name="shopping_list/[shopping_list_id]/item/[shopping_list_item_id]"
      />
    </Stack>
  );
}