import { Wifi, WifiOff } from '@mui/icons-material'
import { Box, Switch } from '@mui/material'
import { useConnectivityState } from 'electric-sql/react'

export const ConnectivityToggle = () => {
  const { connectivityState, toggleConnectivityState } = useConnectivityState()
  const connected = connectivityState == 'connected'
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
