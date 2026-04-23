import React from 'react'
import { Box, Text, renderToString } from 'ink'

interface EntityType {
  name: string
  description: string
  serve_endpoint?: string
}

function TypesTable({ types }: { types: Array<EntityType> }) {
  // Group by serve_endpoint (server)
  const groups = new Map<string, Array<EntityType>>()
  for (const t of types) {
    const server = t.serve_endpoint ?? `built-in`
    if (!groups.has(server)) groups.set(server, [])
    groups.get(server)!.push(t)
  }

  const entries = Array.from(groups.entries())

  return (
    <Box flexDirection="column">
      {entries.map(([server, serverTypes], i) => (
        <Box key={server} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
          <Text bold dimColor>
            {server === `built-in` ? `Built-in agents` : server}
          </Text>
          <Box>
            <Box width={25}>
              <Text bold>NAME</Text>
            </Box>
            <Text bold>DESCRIPTION</Text>
          </Box>
          <Box>
            <Box width={25}>
              <Text dimColor>{`─`.repeat(23)}</Text>
            </Box>
            <Text dimColor>{`─`.repeat(40)}</Text>
          </Box>
          {serverTypes.map((t) => (
            <Box key={t.name}>
              <Box width={25} flexShrink={0}>
                <Text>{t.name}</Text>
              </Box>
              <Box flexGrow={1}>
                <Text wrap="wrap">{t.description}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export function renderTypesTable(types: Array<EntityType>): void {
  console.log(renderToString(<TypesTable types={types} />))
}
