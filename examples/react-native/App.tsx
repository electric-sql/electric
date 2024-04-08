import 'react-native-get-random-values';
import React from 'react';
import {SafeAreaView, ScrollView, StatusBar} from 'react-native';

import {styles} from './src/styles';
import {ElectricProvider} from './src/ElectricProvider';
import {Example} from './src/Example';

const App = (): JSX.Element => {
  return (
    <SafeAreaView style={styles.appContainer}>
      <StatusBar
        barStyle={'light-content'}
        backgroundColor={styles.appContainer.backgroundColor}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <ElectricProvider>
          <Example />
        </ElectricProvider>
      </ScrollView>
    </SafeAreaView>
  );
};

export default App;
