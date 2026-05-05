import { useCallback, useState } from 'react'
import styles from './Splitter.module.css'

/**
 * Pure draggable divider between two children of a Split.
 *
 * The parent owns the sizing state (it lives in the workspace tree)
 * and passes a `onResize(deltaPx, totalPx)` callback. We compute the
 * percentage delta inside the callback so the parent only has to call
 * `dispatch({ type: 'resize-split', sizes: [...] })` with normalised
 * fractions.
 */
export function Splitter({
  direction,
  onResize,
  /**
   * Total length of the parent split (in px) at drag start. Used to
   * convert the drag delta into a fractional change. Re-measured on
   * each `mousedown` via the callback rather than passed through props
   * so it always reflects the live container size.
   */
  measureContainer,
}: {
  direction: `horizontal` | `vertical`
  measureContainer: () => number
  onResize: (deltaFraction: number) => void
}): React.ReactElement {
  const [active, setActive] = useState(false)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const start = direction === `horizontal` ? e.clientX : e.clientY
      const total = measureContainer()
      if (total <= 0) return
      setActive(true)
      const move = (ev: MouseEvent) => {
        const cur = direction === `horizontal` ? ev.clientX : ev.clientY
        const delta = (cur - start) / total
        onResize(delta)
      }
      const up = () => {
        document.removeEventListener(`mousemove`, move)
        document.removeEventListener(`mouseup`, up)
        document.body.style.cursor = ``
        document.body.style.userSelect = ``
        setActive(false)
      }
      document.body.style.cursor =
        direction === `horizontal` ? `col-resize` : `row-resize`
      document.body.style.userSelect = `none`
      document.addEventListener(`mousemove`, move)
      document.addEventListener(`mouseup`, up)
    },
    [direction, measureContainer, onResize]
  )

  const cls = [
    styles.splitter,
    direction === `horizontal` ? styles.horizontal : styles.vertical,
    active ? styles.active : null,
  ]
    .filter(Boolean)
    .join(` `)

  return (
    <div
      role="separator"
      aria-orientation={direction === `horizontal` ? `vertical` : `horizontal`}
      className={cls}
      onMouseDown={onMouseDown}
    />
  )
}
