import { Row } from "@electric-sql/client"

export interface Item extends Row {
  id: string
  value: string
  [key: string]: string
}
