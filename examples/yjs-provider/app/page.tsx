"use server"

import React from "react"
import ElectricEditor from "./electric-editor"
import { getAwarenessData, getDocData } from "./ydoc-shape"

const Page = async () => (
  <ElectricEditor
    docShape={await getDocData()}
    awarenessShape={await getAwarenessData()}
  />
)

export default Page
