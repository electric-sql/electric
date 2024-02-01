import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Drawer } from 'expo-router/drawer';
import { DrawerContentScrollView, DrawerItem, DrawerItemList } from '@react-navigation/drawer';
import { SafeAreaView } from 'react-native';
import { useAuthActions } from '../../../components/AuthProvider';
import { Icon } from 'react-native-paper';
import { router } from 'expo-router';

export default function HomeLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer drawerContent={AppDrawerContent}>
        <Drawer.Screen
          name="shopping_lists"
          options={{
            drawerLabel: 'Shopping Lists',
            drawerIcon: (props) => <Icon source="cart-outline" {...props} />,
            title: 'Shopping Lists',
          }}
        />
        <Drawer.Screen
          name="family"
          options={{
            drawerLabel: 'Families',
            drawerIcon: (props) => <Icon source="account-group-outline" {...props} />,
            title: 'Families',
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}

function AppDrawerContent(props: any){
  const { signOut } = useAuthActions()
  return (
     <DrawerContentScrollView {...props}
      scrollEnabled={false}
      contentContainerStyle={{ flex: 1 }}
      >
       <DrawerItemList {...props}/>
       <SafeAreaView style={{ flex: 1, justifyContent: 'flex-end' }}>
         <DrawerItem
           label="Log out"
           icon={(props) => <Icon source="logout" {...props}/>}
           onPress={() => {
            signOut()

            // NOTE(msfstef): no proper API to clear history yet
            // see: https://github.com/expo/router/discussions/495
            while (router.canGoBack()) {
              router.back()
            }
            router.replace('/sign_in')
           }}
         />
       </SafeAreaView>
     </DrawerContentScrollView>
   );
 }