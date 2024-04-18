import { useConnectivityState } from 'electric-sql/react'
import clsx from 'clsx'
import { useElectric } from '../../electric'
import styles from './styles.module.css'

const colors = {
  available: 'script-yellow',
  connected: 'electric-green',
  disconnected: 'script-red',
}

const ConnectivityControl = () => {
  const electric = useElectric()!
  const { status } = useConnectivityState()

  const toggleConnectivityState = async (): Promise<void> =>
    status === 'connected' ? electric.disconnect() : electric.connect()

  const connectivityStyle =
    status === 'disconnected' ? 'connectivity-off' : 'connectivity-on'

  const labelStyle = {
    color: 'red', //`var(--${colors[status]})`,
  }

  return (
    <label className="text-small" style={labelStyle}>
      <a
        onMouseDown={toggleConnectivityState}
        className="flex flex-row items-center text-current hover:text-current cursor-pointer"
      >
        <span className="capitalize">{status}</span>
        <div
          className={clsx(
            'ml-1 w-5',
            styles['connectivity-icon'],
            styles[connectivityStyle],
          )}
          style={{ backgroundColor: labelStyle.color }}
        />
      </a>
    </label>
  )
}

export default ConnectivityControl
