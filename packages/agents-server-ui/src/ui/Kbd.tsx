import { Children, forwardRef, type ReactNode } from 'react'
import styles from './Kbd.module.css'

type KbdProps = {
  className?: string
  children?: ReactNode
}

/**
 * Keycap primitive — renders a tiny pill that visually represents a
 * keyboard key (e.g. `<Kbd>⌘K</Kbd>` or `<Kbd>esc</Kbd>`).
 *
 * Multiple keys can be rendered as siblings inside a single `<Kbd>` —
 * each child becomes its own keycap and they are laid out in a tight row
 * separated by a 2px gap, for keycap-hint rows used in top-bar buttons
 * and the search palette footer.
 *
 *   <Kbd>⌘K</Kbd>
 *   <Kbd>⌘ K</Kbd>           -> single key, literal text
 *   <Kbd>{['⌘', 'K']}</Kbd>  -> two keys side by side
 */
export const Kbd = forwardRef<HTMLSpanElement, KbdProps>(function Kbd(
  { className, children },
  ref
) {
  const childArr = Children.toArray(children)
  if (childArr.length <= 1) {
    return (
      <span
        ref={ref}
        className={[styles.kbd, className].filter(Boolean).join(` `)}
      >
        {children}
      </span>
    )
  }
  return (
    <span
      ref={ref}
      className={[styles.row, className].filter(Boolean).join(` `)}
    >
      {childArr.map((child, i) => (
        <span key={i} className={styles.kbd}>
          {child}
        </span>
      ))}
    </span>
  )
})
