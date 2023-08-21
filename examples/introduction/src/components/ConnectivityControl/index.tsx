import React from 'react'
import { useConnectivityState } from 'electric-sql/react'

import OnIcon from '@site/static/img/icons/wifi-on.svg'
import OffIcon from '@site/static/img/icons/wifi-off.svg'

const colors = {
  available: 'script-yellow',
  connected: 'electric-green',
  disconnected: 'script-red'
}

const ConnectivityControl = () => {
  const { connectivityState, toggleConnectivityState } = useConnectivityState()

  const Icon =
    connectivityState === 'disconnected'
    ? OffIcon
    : OnIcon

  const labelStyle = {
    color: `var(--${colors[connectivityState]})`
  }

  return (
    <label className="text-small" style={labelStyle}>
      <a onMouseDown={ toggleConnectivityState }
          className="flex flex-row items-center text-current hover:text-current cursor-pointer">
        <span className="capitalize">
          { connectivityState }
        </span>
        <Icon className="ml-1 w-5" />
      </a>
    </label>
  )
}

export default ConnectivityControl
