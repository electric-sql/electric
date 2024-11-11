"use server"

import React from "react"
import Home from "./page-client"
import { getShapeData } from "./ydoc-shape"

const Page = async () => <Home shapeData={await getShapeData()} />

export default Page
