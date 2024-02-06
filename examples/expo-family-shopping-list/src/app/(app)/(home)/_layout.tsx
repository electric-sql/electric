import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Drawer } from 'expo-router/drawer';
import {
  DrawerContentComponentProps, DrawerContentScrollView,
  DrawerHeaderProps, DrawerItem, DrawerItemList
} from '@react-navigation/drawer';
import { RegisteredStyle, SafeAreaView, TextStyle } from 'react-native';
import { useAuthActions } from '../../../components/AuthProvider';
import { Appbar, Icon } from 'react-native-paper';

export default function HomeLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer drawerContent={AppDrawerContent} screenOptions={{
        header: AppDrawerHeader,
      }}>
        <Drawer.Screen
          name="shopping_lists"
          options={{
            drawerLabel: 'Shopping Lists',
            drawerIcon: (props) => 
              <Icon {...props}
                source={props.focused ? "cart" : "cart-outline"}
              />,
            title: 'Shopping Lists',
          }}
        />
        <Drawer.Screen
          name="family"
          options={{
            drawerLabel: 'Families',
            drawerIcon: (props) => 
              <Icon {...props}
                source={props.focused ? "account-group" : "account-group-outline"}
              />,
            title: 'Families',
          }}
        />
        <Drawer.Screen
          name="personal_code"
          options={{
            drawerLabel: 'Join a Family',
            drawerIcon: (props) => <Icon {...props} source={"qrcode"} />,
            
            title: 'Join a Family',
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}

function AppDrawerHeader(props: DrawerHeaderProps) {
  const headerTitle = (props.options.title ?? props.options.headerTitle)
  return (
    <Appbar.Header>
      <Appbar.Action icon="menu" onPress={props.navigation.toggleDrawer} />
      { headerTitle && 
        <Appbar.Content
          title={headerTitle as string}
          titleStyle={props.options.headerTitleStyle as RegisteredStyle<TextStyle>}
        />
      }
    </Appbar.Header>
  )
}

function AppDrawerContent(props: DrawerContentComponentProps){
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
           onPress={() => signOut()}
         />
       </SafeAreaView>
     </DrawerContentScrollView>
   );
 }