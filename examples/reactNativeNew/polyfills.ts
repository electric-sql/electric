import 'react-native-url-polyfill/auto';
import 'fastestsmallesttextencoderdecoder';
import 'react-native-get-random-values';
import {decode, encode} from 'base-64';

if (!global.btoa) {
  global.btoa = encode;
}

if (!global.atob) {
  global.atob = decode;
}
