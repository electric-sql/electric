import { Transition } from '@headlessui/react'
import { useRef } from 'react'
import classnames from 'classnames'
import { useConnectivityState } from 'electric-sql/react'
import { useClickOutside } from '../hooks/useClickOutside'
import { useElectric } from '../electric'
import Toggle from './Toggle'
import { v4 as uuidv4 } from 'uuid'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
  setShowAboutModal?: (show: boolean) => void
  className?: string
}
export default function ProfileMenu({
  isOpen,
  className,
  onDismiss,
  setShowAboutModal,
}: Props) {
  const electric = useElectric()!
  const db = electric.db
  const connectivityState = useConnectivityState()
  const classes = classnames(
    'select-none w-53 shadow-modal z-50 flex flex-col py-1 bg-white font-normal rounded text-gray-800',
    className
  )
  const ref = useRef(null)

  const connectivityConnected = connectivityState.status !== 'disconnected'
  const connectivityStateDisplay =
    connectivityState.status[0].toUpperCase() +
    connectivityState.status.slice(1)

  const toggleConnectivityState = () => {
    if (connectivityConnected) {
      electric.disconnect()
    } else {
      electric.connect()
    }
  }

  useClickOutside(ref, () => {
    if (isOpen && onDismiss) {
      onDismiss()
    }
  })

  const newProject = () => {
    const name = prompt('Enter project name')
    if (!name) return
    db.project.create({
      data: {
        id: uuidv4(),
        name: name,
      },
    })
  }

  return (
    <div ref={ref}>
      <Transition
        show={isOpen}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition easy-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <div className={classes}>
          <button
            className="flex items-center h-8 px-3 hover:bg-gray-100"
            onClick={newProject}
          >
            New Project
          </button>
          <button
            className="flex items-center h-8 px-3 hover:bg-gray-100"
            onClick={() => {
              setShowAboutModal?.(true)
              onDismiss?.()
            }}
          >
            About
          </button>
          <a
            href="https://www.electric-sql.com"
            className="flex items-center h-8 px-3 hover:bg-gray-100"
          >
            Visit ElectricSQL
          </a>
          <a
            href="https://www.electric-sql.com/docs"
            className="flex items-center h-8 px-3 hover:bg-gray-100"
          >
            Documentation
          </a>
          <a
            href="https://github.com/electric-sql/electric/tree/main/examples/linearlite"
            className="flex items-center h-8 px-3 hover:bg-gray-100"
          >
            GitHub
          </a>
          <div className="border-t flex items-center h-8 px-3">
            <span className="text-gray-500 me-auto">
              {connectivityStateDisplay}
            </span>
            <Toggle
              value={connectivityConnected}
              onChange={toggleConnectivityState}
              activeClass="bg-green-500 hover:bg-green-700"
              activeLabelClass="border-green-500"
            />
          </div>
        </div>
      </Transition>
    </div>
  )
}
