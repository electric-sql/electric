import React, { useEffect, useState } from 'react'
import { ToolbarTabsProps } from '../tabs'
import { Badge, Box, Table, Text } from '@radix-ui/themes'

export default function ShapesTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [shapes, setShapes] = useState(
    api.getSatelliteShapeSubscriptions(dbName),
  )

  useEffect(() => {
    // periodically refresh shape subscriptions
    const interval = setInterval(
      () => setShapes(api.getSatelliteShapeSubscriptions(dbName)),
      1000,
    )
    return () => clearInterval(interval)
  }, [dbName, api])

  if (shapes.length === 0) {
    return (
      <Box>
        <Text>No shape subscriptions found</Text>
      </Box>
    )
  }

  return (
    <Box>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>
              Shape Subscription ID
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Tablename</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Include</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Where</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {shapes.map(({ id, tablename, include = [], where }) => (
            <Table.Row key={id}>
              <Table.Cell>{id}</Table.Cell>
              <Table.Cell>{tablename}</Table.Cell>
              <Table.Cell>
                {include.length === 0
                  ? 'N/A'
                  : include.map((v) => v.select.tablename).join(', ')}
              </Table.Cell>
              <Table.Cell>{where ?? 'N/A'}</Table.Cell>
              <Table.Cell>
                {/* TODO: add shape status once available */}
                <Badge color="green">Active</Badge>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  )
}
