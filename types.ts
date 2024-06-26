type Header = {
  key: string
  value: any
}

// Define the type for a record
export type Message = {
  key?: any
  value?: any
  headers?: Header
  offset?: number
}
