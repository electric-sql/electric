:::caution Polyfills
Electric makes use of the [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) for UUID generation, which is no available in React Native environments by default. You can provide a polyfill for this to ensure UUID uniqueness guarantees, like [`react-native-get-random-values`](https://www.npmjs.com/package/react-native-get-random-values):
```bash
npm install react-native-get-random-values
npx pod-install # unnecessary if using Expo managed workflow
``` 
And in your app's entry point, like `App.js` the root-level `_layout.js` if using `expo-router`:
```js
import 'react-native-get-random-values'
... other imports ...

export default App
```
:::