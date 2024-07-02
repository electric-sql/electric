import { useState, useEffect } from "react"
import { ShapeStream, ShapeStreamOptions } from "./client"
import { Message } from "./types"

export function useShape(config: ShapeStreamOptions) {
  const [shapeData, setShapeData] = useState<unknown[]>([])

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
            [`insert`, `update`].includes(
              (message.headers?.[`action`] as string | undefined) ?? ``
            )
          )

          // Upsert/delete new data
          switch (message.headers?.[`action`]) {
            case `insert`:
            case `update`:
              shapeMap.set(message.key, message.value)
              break
            case `delete`:
              shapeMap.delete(message.key)
              break
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
