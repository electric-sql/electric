import { Slot } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import ElectricProvider from '../components/ElectricProvider';

export default function RootLayout() {
  return (
    <PaperProvider>
      <ElectricProvider>
        <Slot />
      </ElectricProvider>
    </PaperProvider>
  )
}