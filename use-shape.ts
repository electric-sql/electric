import { useState, useEffect } from "react"
import { ShapeStream } from "./client"
import { Message } from "./types"

export function useShape(config) {
  const [shapeData, setShapeData] = useState([])

  useEffect(() => {
    async function stream() {
      let upToDate = false
      const shapeMap = new Map()
      function updateSubscribers() {
        setShapeData([...shapeMap.values()])
      }
      console.log(`new ShapeStream`)
      const issueStream = new ShapeStream(config)
      issueStream.subscribe((messages: Message[]) => {
        messages.forEach(async (message) => {
          console.log({ message })
          console.log(
            `message`,
            message,
            message.headers?.[`action`],
            [`insert`, `update`].includes(message.headers?.[`action`])
          )

          // Upsert/delete new data
          if (message.headers?.[`action`] === `delete`) {
            shapeMap.delete(message.key)
          } else if (
            [`insert`, `update`].includes(message.headers?.[`action`])
          ) {
            shapeMap.set(message.key, message.value)
          }

          // Control message telling client they're up-to-date
          if (message.headers?.[`control`] === `up-to-date`) {
            upToDate = true
          }
        })
        if (upToDate && messages.length > 0) {
          updateSubscribers()
        }
      })
    }
    stream()
  }, [])

  return shapeData
}
