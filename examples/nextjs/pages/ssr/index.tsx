import type { GetServerSideProps } from "next"
import {
  HydratedShapeData,
  preloadShape,
  hydrateShape,
} from "@electric-sql/react"
import { itemShapeOptions } from "@/app/items"
import { Item } from "@/app/types"
import "@/app/App.css"
import "@/app/style.css"
import { ItemsList } from "@/app/items-list"

export const getServerSideProps: GetServerSideProps<{
  shape: HydratedShapeData<Item>
}> = async () => {
  const shape = await preloadShape<Item>(itemShapeOptions)

  return {
    props: {
      shape: hydrateShape(shape),
    },
  }
}

export default function Page(props: { shape: HydratedShapeData<Item> }) {
  return <ItemsList initialShape={props.shape} />
}
