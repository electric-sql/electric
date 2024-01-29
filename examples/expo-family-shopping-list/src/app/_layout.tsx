import { Slot } from 'expo-router';
import ElectricProvider from '../components/ElectricProvider';

export default function RootLayout() {
  return (
    <ElectricProvider>
      <Slot />
    </ElectricProvider>
  )
}