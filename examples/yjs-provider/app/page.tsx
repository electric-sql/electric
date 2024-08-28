"use server"

import React from "react"
import Home from "./page-client"
import { getShapeData } from "./shape"

const Page = async () => <Home shapeData={getShapeData()} />

export default Page
