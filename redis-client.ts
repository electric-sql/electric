import { createClient } from "redis"
import { ShapeStream } from "../client"
import { Message } from "../types"

// Create a Redis client
const client = createClient({
  host: `localhost`, // Redis server hostname (localhost for Docker container running on host)
  port: 6379, // Redis server port
})

client.connect().then(() => {
  console.log(`Connected to Redis server`)

  const issueStream = new ShapeStream({
    shape: { table: `todos` },
    baseUrl: `http://localhost:3000`,
    subscribe: true,
  })
  issueStream.subscribe(async (messages: Message[]) => {
    console.log(`messages`, messages)
    // Begin a Redis transaction
    const pipeline = client.multi()

    // Loop through each message and make writes to the Redis hash for action messages
    messages.forEach((message) => {
      // Upsert/delete
      if (message.headers?.[`action`] === `delete`) {
        pipeline.hDel(`issues`, message.key)
      } else if ([`insert`, `update`].includes(message.headers?.[`action`])) {
        const jsonData = JSON.stringify(message.value)
        pipeline.hSet(`issues`, String(message.key), jsonData)
      }
    })

    // Execute all commands as a single transaction
    try {
      await pipeline.exec()
      console.log(`Hash updated successfully`)
    } catch (error) {
      console.error(`Error while updating hash:`, error)
    }
  })
})
