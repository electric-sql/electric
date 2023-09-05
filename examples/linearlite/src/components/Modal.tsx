import React, {
  memo,
  MouseEventHandler,
  RefObject,
  useCallback,
  useRef,
} from 'react'
import ReactDOM from 'react-dom'
import classnames from 'classnames'

import { ReactComponent as CloseIcon } from '../assets/icons/close.svg'
import { useClickOutside } from '../hooks/useClickOutside'
import useLockBodyScroll from '../hooks/useLockBodyScroll'
import { Transition } from '@headlessui/react'

interface Props {
  title?: string
  isOpen: boolean
  center: boolean
  className?: string
  /* function called when modal is closed */
  onDismiss?: () => void
  children?: React.ReactNode
  size: 'normal' | 'large'
}
const sizeClasses = {
  large: 'w-175',
  normal: 'w-140',
}

function Modal({
  title,
  isOpen,
  center,
  size,
  className,
  onDismiss,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null) as RefObject<HTMLDivElement>
  const outerRef = useRef(null)

  const wrapperClasses = classnames(
    'fixed flex flex-col items-center inset-0 z-50',
    {
      'justify-center': center,
    }
  )
  const modalClasses = classnames(
    'flex flex-col items-center overflow-hidden transform bg-white modal shadow-large-modal rounded-xl',
    {
      'mt-20 mb-2 ': !center,
    },
    sizeClasses[size],
    className
  )
  const handleClick = useCallback((e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!onDismiss) return
    if (ref.current && !ref.current.contains(e.target)) {
      onDismiss()
    }
  }, [])

  useLockBodyScroll()

  let modal = (
    <div ref={outerRef} onClick={handleClick}>
      <Transition
        show={isOpen}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition easy-in duration-95"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
        className={wrapperClasses}
      >
        <div ref={ref} className={modalClasses}>
          {title && (
            <div className="flex items-center justify-between w-full pl-8 pr-4 border-b border-gray-200">
              <div className="text-sm font-semibold text-gray-700">{title}</div>
              <div className="p-4" onClick={onDismiss}>
                <CloseIcon className="w-4 text-gray-500 hover:text-gray-700" />
              </div>
            </div>
          )}
          {children}
        </div>
      </Transition>
    </div>
  )

  return ReactDOM.createPortal(
    modal,
    document.getElementById('root-modal') as Element
  )
}

Modal.defaultProps = {
  size: 'normal',
  center: true,
}

export default memo(Modal)
