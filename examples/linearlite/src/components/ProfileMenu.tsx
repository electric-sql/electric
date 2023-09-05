import { Transition } from '@headlessui/react'
import classnames from 'classnames'
import { useClickOutside } from '../hooks/useClickOutside'
import { useRef } from 'react'

interface Props {
  isOpen: boolean
  onDismiss?: () => void
  className?: string
}
export default function ProfileMenu({ isOpen, className, onDismiss }: Props) {
  const classes = classnames(
    'select-none w-53 shadow-modal z-50 flex flex-col py-1 bg-white font-normal rounded text-gray-800',
    className
  )
  const ref = useRef(null)

  useClickOutside(ref, () => {
    if (isOpen && onDismiss) {
      onDismiss()
    }
  })

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
        className={classes}
      >
        <div className="flex items-center h-8 px-3 hover:bg-gray-100">
          View profile
        </div>
        <div className="flex items-center h-8 px-3 hover:bg-gray-100 ">
          Settings
        </div>
        <div className="flex items-center h-8 px-3 hover:bg-gray-100 ">
          Show keyboard shortcuts
        </div>
        <div className="w-full px-3 my-1 border-b border-gray-200"></div>
        <div className="flex items-center h-8 px-3 hover:bg-gray-100 ">
          Changelog
        </div>
        <div className="flex items-center h-8 px-3 hover:bg-gray-100 ">
          Join Slack Community
        </div>
        <div className="flex items-center h-8 px-3 hover:bg-gray-100 ">
          Help & Support
        </div>
        <div className="flex items-center h-8 px-3 hover:bg-gray-100 ">API</div>
        <div className="w-full px-3 my-1 border-b border-gray-200"></div>
        <div className="flex items-center h-8 px-3 hover:bg-gray-100">
          Logout
        </div>
      </Transition>
    </div>
  )
}
