import React, { useEffect, useState } from 'react'
import { ToolbarTabsProps } from '../tabs'
import { ConnectivityState } from 'electric-sql/util'
import {
  Badge,
  Box,
  Flex,
  DataList,
  Spinner,
  Switch,
  Text,
} from '@radix-ui/themes'

export default function StatusTab({
  dbName,
  api,
}: ToolbarTabsProps): JSX.Element {
  const [status, setStatus] = useState<ConnectivityState | null>(
    api.getSatelliteStatus(dbName),
  )

  useEffect(() => {
    const unsubscribe = api.subscribeToSatelliteStatus(dbName, setStatus)
    return unsubscribe
  }, [dbName, api])

  if (!status) {
    return (
      <Flex align="center" gap="3">
        <Spinner />
        <Text size="4">Waiting for satellite process...</Text>
      </Flex>
    )
  }

  return (
    <Box>
      <DataList.Root>
        <DataList.Item>
          <DataList.Label>Toggle Connection</DataList.Label>
          <DataList.Value>
            <Switch
              onCheckedChange={() => api.toggleSatelliteStatus(dbName)}
              checked={status.status === 'connected'}
            />
          </DataList.Value>
        </DataList.Item>
        <DataList.Item>
          <DataList.Label>Status</DataList.Label>
          <DataList.Value>
            <Badge
              style={{ textTransform: 'capitalize' }}
              color={status.status === 'connected' ? 'green' : 'red'}
            >
              {status.status}
            </Badge>
          </DataList.Value>
        </DataList.Item>
        {status.reason && (
          <DataList.Item>
            <DataList.Label>Reason</DataList.Label>
            <DataList.Value>{status.reason.message}</DataList.Value>
          </DataList.Item>
        )}
      </DataList.Root>
    </Box>
  )
}
