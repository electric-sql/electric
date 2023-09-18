import {} from 'squel'

declare module 'squel' {
  export interface ToParamOptions {
    numberedParametersStartAt?: number
    numberedParameters?: boolean
  }
}
