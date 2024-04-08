import 'react-native-get-random-values'
import React from 'react'
import { SafeAreaView, ScrollView, StatusBar } from 'react-native'

import { ElectricProvider } from './src/ElectricProvider'
import { Example } from './src/Example'
import { styles } from './src/styles'

const App = () => {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={'light-content'}
        backgroundColor={styles.container.backgroundColor}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <ElectricProvider>
          <Example />
        </ElectricProvider>
      </ScrollView>
    </SafeAreaView>
  )
}

export default App
