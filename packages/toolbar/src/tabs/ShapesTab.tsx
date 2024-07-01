import React, { useEffect, useState } from 'react'
import { ToolbarTabsProps } from '../tabs'
import { Badge, Box, Table, Text } from '@radix-ui/themes'
import { SyncStatus } from 'electric-sql/client/model'

export default function ShapesTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [shapes, setShapes] = useState(
    api.getSatelliteShapeSubscriptions(dbName),
  )

  useEffect(() => {
    const unsubscribe = api.subscribeToSatelliteShapeSubscriptions(
      dbName,
      setShapes,
    )
    return unsubscribe
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
              Shape Subscription Key
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Tablename</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Include</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Where</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {shapes.map(({ key, shape, status }) => (
            <Table.Row key={key}>
              <Table.Cell>{key}</Table.Cell>
              <Table.Cell>{shape.tablename}</Table.Cell>
              <Table.Cell>
                {!shape.include || shape.include.length === 0
                  ? ''
                  : shape.include.map((v) => v.select.tablename).join(', ')}
              </Table.Cell>
              <Table.Cell>{shape.where ?? ''}</Table.Cell>
              <Table.Cell>
                <ShapeStatusBadge status={status} />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  )
}

const ShapeStatusBadge = ({ status }: { status: SyncStatus }) => {
  if (!status) return null
  switch (status.status) {
    case 'active':
      return <Badge color="green">Active</Badge>
    case 'establishing':
      return <Badge color="orange">Establishing</Badge>
    case 'cancelling':
      return <Badge color="red">Cancelled</Badge>
  }
}
