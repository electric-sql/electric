import { Redirect, Stack } from 'expo-router';
import ElectricProvider from '../../components/ElectricProvider';
import { useAccessToken, useAuthenticationState } from '../../components/AuthProvider';

export default function AppLayout() {
  const { authenticated } = useAuthenticationState()
  const accessToken = useAccessToken()
  if (!authenticated) return <Redirect href="/" />
  return (
    <ElectricProvider accessToken={accessToken!}>
      <Stack screenOptions={{
        headerBackTitleVisible: false,
        contentStyle: {
          padding: 16,
        }
      }}>
        <Stack.Screen
          name="(home)"
          options={{
            headerShown: false,
            contentStyle: {
              padding: 0
            }
          }}
        />

        <Stack.Screen
          name="shopping_list/[shopping_list_id]/index"
          options={{
            contentStyle: {
              paddingHorizontal: 16
            }
          }}
        />
        <Stack.Screen
          name="shopping_list/add"
          options={{
            title: 'Create shopping list',
            presentation: 'card',
          }}
        />
        <Stack.Screen
          name="shopping_list/[shopping_list_id]/edit"
          options={{
            title: 'Edit shopping list',
            presentation: 'formSheet',
          }}
        />
        <Stack.Screen
          name="shopping_list/[shopping_list_id]/item/add"
          options={{
            title: 'Add shopping list item',
            presentation: 'formSheet',
          }}
        />

        <Stack.Screen
          name="family/[family_id]/index"
          options={{
            headerTitle: 'Family',
            contentStyle: {
              paddingHorizontal: 16
            }
          }}
        />
        <Stack.Screen
          name="family/[family_id]/edit"
          options={{
            headerTitle: 'Edit family',
            presentation: 'formSheet',
          }}
        />
        <Stack.Screen
          name="family/[family_id]/member/[member_id]/edit"
          options={{
            headerTitle: 'Edit member',
            presentation: 'formSheet',
          }}
        />
      </Stack>
    </ElectricProvider>
  );
}