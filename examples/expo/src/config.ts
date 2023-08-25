import { NativeModules } from 'react-native';
const { hostname } = new URL(NativeModules.SourceCode.scriptURL)

export const DEBUG_MODE:boolean = process.env.DEBUG_MODE === 'true'
export const ELECTRIC_URL:string = process.env.ELECTRIC_URL ?? `ws://${hostname}:5133`
