import { Fragment, useCallback, useRef } from 'react'
import { useWorkspace } from '../../hooks/useWorkspace'
import type { Split } from '../../lib/workspace/types'
import { NodeRenderer } from './NodeRenderer'
import { Splitter } from './Splitter'
import styles from './SplitContainer.module.css'

/**
 * Renders a split node — `n` panes (sized by their `size` fraction)
 * separated by `n-1` `<Splitter>`s.
 *
 * Resize is fully controlled: the splitter calls `onResize(delta)` with
 * a fractional delta (0..1) and we dispatch `resize-split` to the
 * reducer. The reducer normalises sibling sizes so this stays well-
 * formed even after pathological drags.
 */
export function SplitContainer({
  split,
}: {
  split: Split
}): React.ReactElement {
  const { helpers } = useWorkspace()
  const containerRef = useRef<HTMLDivElement>(null)

  // Used by `<Splitter>` to convert a px delta into a fractional one.
  // Re-measured on each drag start to handle window resizes between
  // drags without state.
  const measureContainer = useCallback(() => {
    const el = containerRef.current
    if (!el) return 0
    return split.direction === `horizontal` ? el.clientWidth : el.clientHeight
  }, [split.direction])

  const onResizeAt = useCallback(
    (boundaryIndex: number, deltaFraction: number) => {
      // Re-balance only the two siblings adjacent to the dragged
      // boundary — keeps the rest of the row stable when there are
      // 3+ panes (matches VS Code).
      const sizes = split.children.map((c) => c.size)
      const left = sizes[boundaryIndex]
      const right = sizes[boundaryIndex + 1]
      const min = 0.05 // never shrink a pane below 5% of the split
      let delta = deltaFraction
      if (left + delta < min) delta = min - left
      if (right - delta < min) delta = right - min
      sizes[boundaryIndex] = left + delta
      sizes[boundaryIndex + 1] = right - delta
      helpers.resizeSplit(split.id, sizes)
    },
    [split.children, split.id, helpers]
  )

  return (
    <div
      ref={containerRef}
      className={`${styles.split} ${
        split.direction === `horizontal` ? styles.horizontal : styles.vertical
      }`}
    >
      {split.children.map((child, i) => (
        <Fragment key={child.node.id}>
          {i > 0 && (
            <Splitter
              direction={split.direction}
              measureContainer={measureContainer}
              onResize={(delta) => onResizeAt(i - 1, delta)}
            />
          )}
          <div
            className={styles.pane}
            style={{
              flexBasis: `${child.size * 100}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <NodeRenderer node={child.node} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
