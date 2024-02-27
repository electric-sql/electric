import { Wifi, WifiOff } from '@mui/icons-material'
import { Box, Switch } from '@mui/material'
import { useConnectivityState } from 'electric-sql/react'
import { useElectric } from '../electric/ElectricWrapper'

export const ConnectivityToggle = () => {
  const electric = useElectric()!
  const connectivityState = useConnectivityState()
  const toggleConnectivityState = () =>
    electric.isConnected ? electric.disconnect() : electric.connect()
  const connected = connectivityState.status == 'connected'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Switch
        color="secondary"
        size="small"
        sx={{ mr: 1 }}
        checked={connected}
        onChange={toggleConnectivityState}
      />
      {connected ? <Wifi /> : <WifiOff />}
    </Box>
  )
}
