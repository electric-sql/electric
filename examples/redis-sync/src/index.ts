import { createClient } from 'redis'
import { ShapeStream, Message, isChangeMessage } from '@electric-sql/client'

// Create a Redis client
const REDIS_HOST = `localhost`
const REDIS_PORT = 6379
const client = createClient({
  url: `redis://${REDIS_HOST}:${REDIS_PORT}`,
})

client.connect().then(async () => {
  console.log(`Connected to Redis server`)

  // Clear out old data on the hash.
  client.del(`items`)

  // Lua script for updating hash field. We need to merge in partial updates
  // from the shape log.
  const script = `
      local current = redis.call('HGET', KEYS[1], KEYS[2])
      local parsed = {}
      if current then
        parsed = cjson.decode(current)
      end
      for k, v in pairs(cjson.decode(ARGV[1])) do
        parsed[k] = v
      end
      local updated = cjson.encode(parsed)
      return redis.call('HSET', KEYS[1], KEYS[2], updated)
    `

  // Load the script into Redis and get its SHA1 digest
  const updateKeyScriptSha1 = await client.SCRIPT_LOAD(script)

  const itemsStream = new ShapeStream({
    url: `http://localhost:3000/v1/shape`,
    table: `items`,
  })
  itemsStream.subscribe(async (messages: Message[]) => {
    // Begin a Redis transaction
    //
    // FIXME The Redis docs suggest only sending 10k commands at a time
    // to avoid excess memory usage buffering commands.
    const pipeline = client.multi()

    // Loop through each message and make writes to the Redis hash for action messages
    messages.forEach((message) => {
      if (!isChangeMessage(message)) return
      console.log(`message`, message)
      // Upsert/delete
      switch (message.headers.operation) {
        case `delete`:
          pipeline.hDel(`items`, message.key)
          break

        case `insert`:
          pipeline.hSet(
            `items`,
            String(message.key),
            JSON.stringify(message.value)
          )
          break

        case `update`: {
          pipeline.evalSha(updateKeyScriptSha1, {
            keys: [`items`, String(message.key)],
            arguments: [JSON.stringify(message.value)],
          })
          break
        }
      }
    })

    // Execute all commands as a single transaction
    try {
      await pipeline.exec()
      console.log(`Redis hash updated successfully with latest shape updates`)
    } catch (error) {
      console.error(`Error while updating hash:`, error)
    }
  })
})
