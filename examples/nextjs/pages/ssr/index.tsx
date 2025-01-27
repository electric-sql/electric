import type { GetServerSideProps } from "next"
import { preloadShape } from "@electric-sql/react"
import { itemShapeOptions } from "@/app/items"
import { Item } from "@/app/types"
import "@/app/App.css"
import "@/app/style.css"
import { ItemsList } from "@/app/items-list"

export const getServerSideProps: GetServerSideProps = async () => {
  await preloadShape<Item>(itemShapeOptions)

  return {
    props: {},
  }
}

export default function Page() {
  return <ItemsList />
}
