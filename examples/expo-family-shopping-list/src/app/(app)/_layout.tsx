import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{
      headerBackTitleVisible: false,
      contentStyle: {
        paddingHorizontal: 16
      }
    }}>
      <Stack.Screen
        name="(home)"
        options={{
          headerShown: false,
          contentStyle: {
            paddingHorizontal: 0
          }
        }}
      />
      <Stack.Screen
        name="shopping_list/[shopping_list_id]/index"
      />
      <Stack.Screen
        name="shopping_list/add"
        options={{
          title: 'Create shopping list',
          presentation: 'formSheet',
          contentStyle: {
            padding: 16
          }
          
        }}
      />
      <Stack.Screen
        name="shopping_list/[shopping_list_id]/item/add"
        options={{
          title: 'Add shopping list item',
          presentation: 'formSheet',
          contentStyle: {
            padding: 16
          }
        }}
      />
      <Stack.Screen
        name="shopping_list/[shopping_list_id]/item/[shopping_list_item_id]"
      />

      <Stack.Screen
        name="family/[family_id]/member/[member_id]/edit"
        options={{
          headerTitle: 'Edit member',
          presentation: 'formSheet',
          contentStyle: {
            padding: 16
          }
        }}
      />
    </Stack>
  );
}