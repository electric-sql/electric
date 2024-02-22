// import 'react-native-get-random-values'
// import 'react-native-url-polyfill/auto'

import React from 'react'
import { SafeAreaView, ScrollView, StatusBar, StyleSheet } from 'react-native'

import { Example } from './src/Example'

const App = () => {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle={'light-content'}
        backgroundColor={styles.container.backgroundColor}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <Example />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgb(19,17,23)',
    color: '#f5f5f5',
    flex: 1,
  },
})

export default App
