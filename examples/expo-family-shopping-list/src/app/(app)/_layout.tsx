import { Redirect, Stack, router } from 'expo-router';
import ElectricProvider from '../../components/ElectricProvider';
import { useAccessToken, useAuthenticationState } from '../../components/AuthProvider';
import { Appbar } from 'react-native-paper';

export default function AppLayout() {
  const { authenticated } = useAuthenticationState()
  Appbar
  const accessToken = useAccessToken()
  if (!authenticated) return <Redirect href="/" />
  return (
    <ElectricProvider accessToken={accessToken!}>
      <Stack screenOptions={{
        headerBackTitleVisible: false,
        header: (props) => {
          const headerTitle = (props.options.headerTitle ?? props.options.title)
          return (
          <Appbar.Header>
            { props.back &&
              <Appbar.BackAction onPress={router.back} />
            }
            { headerTitle && 
              <Appbar.Content
                title={headerTitle as string}
                titleStyle={props.options.headerTitleStyle}
              />
            }
            {
              props.options.headerRight?.({
                canGoBack: props.navigation.canGoBack(),
                tintColor: props.options.headerTintColor
              })
            }
          </Appbar.Header>
          )
        }
        ,
        contentStyle: {
          padding: 16,
        },
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
          name="invite"
          options={{
            title: 'Invite member',
            presentation: 'card',
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
          }}
        />
        <Stack.Screen
          name="shopping_list/[shopping_list_id]/item/add"
          options={{
            title: 'Add shopping list item',
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
          name="family/[family_id]/invite"
          options={{
            title: 'Invite to your family',
            presentation: 'card',
          }}
        />
        <Stack.Screen
          name="family/[family_id]/edit"
          options={{
            headerTitle: 'Edit family',
          }}
        />
        <Stack.Screen
          name="family/[family_id]/member/[member_id]/edit"
          options={{
            headerTitle: 'Edit member',
          }}
        />
      </Stack>
    </ElectricProvider>
  );
}