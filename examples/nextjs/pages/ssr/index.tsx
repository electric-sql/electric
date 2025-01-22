import type { GetServerSideProps } from "next"
import {
  SerializedShapeData,
  preloadShape,
  serializeShape,
} from "@electric-sql/react"
import { itemShapeOptions } from "@/app/items"
import { Item } from "@/app/types"
import "@/app/App.css"
import "@/app/style.css"
import { ItemsList } from "@/app/items-list"

export const getServerSideProps: GetServerSideProps<{
  shape: SerializedShapeData<Item>
}> = async () => {
  const shape = await preloadShape<Item>(itemShapeOptions)

  return {
    props: {
      shape: serializeShape(shape),
    },
  }
}

export default function Page(props: { shape: SerializedShapeData<Item> }) {
  return <ItemsList initialShape={props.shape} />
}
