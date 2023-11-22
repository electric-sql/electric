import { makeElectricContext } from 'electric-sql/react'
import type { Electric } from './generated/client'
import type {
  Items as Item,
  BasketItems as BasketItem,
  Orders as Order,
} from './generated/client'

export { schema } from './generated/client'
export type { Item, BasketItem, Order, Electric }
export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()
