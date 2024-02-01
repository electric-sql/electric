import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Drawer } from 'expo-router/drawer';

export default function HomeLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1}}>
      <Drawer>
        <Drawer.Screen
          name="shopping_lists"
          options={{
            drawerLabel: 'Shopping Lists',
            title: 'Shopping Lists',
          }}
        />
        <Drawer.Screen
          name="family"
          options={{
            drawerLabel: 'Families',
            title: 'Families',
          }}
        />
      </Drawer>
    </GestureHandlerRootView>
  );
}