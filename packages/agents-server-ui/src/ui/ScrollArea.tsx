import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area'
import { forwardRef, type CSSProperties, type ReactNode, type Ref } from 'react'
import styles from './ScrollArea.module.css'

interface ScrollAreaProps {
  /** Which scrollbars to show. Default `vertical`. */
  scrollbars?: `vertical` | `horizontal` | `both`
  className?: string
  style?: CSSProperties
  /** Style passed to the inner viewport element. */
  viewportClassName?: string
  viewportStyle?: CSSProperties
  /** Forwarded to the inner viewport so consumers can attach refs / scroll handlers. */
  viewportRef?: Ref<HTMLDivElement>
  children?: ReactNode
}

/**
 * Custom-scrollbar container — wraps `@base-ui/react/scroll-area`.
 *
 * Replaces `<ScrollArea>` from `@radix-ui/themes`. The `scrollbars` prop
 * matches Radix's API. The viewport ref is exposed via `viewportRef`
 * because the existing timeline code attaches scroll listeners directly
 * to the viewport element.
 */
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea(
    {
      scrollbars = `vertical`,
      className,
      style,
      viewportClassName,
      viewportStyle,
      viewportRef,
      children,
    },
    ref
  ) {
    const rootCls = [styles.root, className].filter(Boolean).join(` `)
    const viewportCls = [styles.viewport, viewportClassName]
      .filter(Boolean)
      .join(` `)
    return (
      <BaseScrollArea.Root ref={ref} className={rootCls} style={style}>
        <BaseScrollArea.Viewport
          ref={viewportRef}
          className={viewportCls}
          style={viewportStyle}
        >
          {children}
        </BaseScrollArea.Viewport>
        {(scrollbars === `vertical` || scrollbars === `both`) && (
          <BaseScrollArea.Scrollbar
            orientation="vertical"
            className={styles.scrollbar}
          >
            <BaseScrollArea.Thumb className={styles.thumb} />
          </BaseScrollArea.Scrollbar>
        )}
        {(scrollbars === `horizontal` || scrollbars === `both`) && (
          <BaseScrollArea.Scrollbar
            orientation="horizontal"
            className={styles.scrollbar}
          >
            <BaseScrollArea.Thumb className={styles.thumb} />
          </BaseScrollArea.Scrollbar>
        )}
      </BaseScrollArea.Root>
    )
  }
)
