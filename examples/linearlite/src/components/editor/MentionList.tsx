import {
  forwardRef, useEffect, useImperativeHandle,
  useState,
} from 'react'
import classnames from 'classnames'

export default forwardRef((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const selectItem = index => {
    const item = props.items[index]

    if (item) {
      props.command({
        id: item.id,
        label: item.title,
      })
    }
  }

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length)
  }

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length)
  }

  const enterHandler = () => {
    selectItem(selectedIndex)
  }

  useEffect(() => setSelectedIndex(0), [props.items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        upHandler()
        return true
      }

      if (event.key === 'ArrowDown') {
        downHandler()
        return true
      }

      if (event.key === 'Enter') {
        enterHandler()
        return true
      }

      return false
    },
  }))

  return (
    <div className={classnames(
      'shadow-modal z-50 flex flex-col py-1 bg-white font-normal rounded text-gray-800'
    )}>
      {props.items.length
        ? props.items.map((item, index) => (
          <button
            // className={`mention_item ${index === selectedIndex ? 'is-selected' : ''}`}
            className={classnames(
              'flex items-center h-8 px-3 text-gray-500 hover:text-gray-800 hover:bg-gray-100',
              { 'bg-gray-100': index === selectedIndex }
            )}
            key={index}
            onClick={() => selectItem(index)}
          >
            <code className="me-2">{item.id.slice(0, 8)}</code>
            {item.title.slice(0, 50)}{item.title.length > 50 ? '...' : ''}
          </button>
        ))
        : <div className="flex items-center h-8 px-3 text-gray-500">No result</div>
      }
    </div>
  )
})