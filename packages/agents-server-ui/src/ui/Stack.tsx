import {
  forwardRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react'
import boxStyles from './Box.module.css'
import stackStyles from './Stack.module.css'
import type { Spacing } from './Box'

type Direction = `row` | `column`
type Align = `start` | `center` | `end` | `stretch` | `baseline`
type Justify = `start` | `center` | `end` | `between` | `around`

type StackOwnProps = {
  as?: ElementType
  className?: string
  style?: CSSProperties
  children?: ReactNode
  direction?: Direction
  align?: Align
  justify?: Justify
  /** gap between children, mapped to --ds-space-* */
  gap?: Spacing
  wrap?: boolean
  /** padding shortcut, like Box */
  p?: Spacing
  px?: Spacing
  py?: Spacing
  /** Flex-grow shorthand */
  grow?: boolean
}

type StackProps = StackOwnProps &
  Omit<React.HTMLAttributes<HTMLElement>, keyof StackOwnProps>

const PAD = (s: Spacing | undefined, prefix: string): string | null => {
  if (s === undefined || s === 0) return null
  return boxStyles[`${prefix}${s}`] ?? null
}
const GAP = (g: Spacing | undefined): string | null => {
  if (g === undefined || g === 0) return null
  return stackStyles[`gap${g}`] ?? null
}

/**
 * Flex layout primitive — replaces `<Flex>` from `@radix-ui/themes`.
 *
 * Defaults to a horizontal row. Use `direction="column"` for vertical
 * stacks. Vertical rhythm is controlled with the `gap` prop, mapped to
 * the design-token spacing scale.
 */
export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  {
    as: Component = `div`,
    className,
    style,
    direction = `row`,
    align,
    justify,
    gap,
    wrap,
    p,
    px,
    py,
    grow,
    ...rest
  },
  ref
) {
  const cls = [
    stackStyles.stack,
    stackStyles[direction],
    align ? stackStyles[`align-${align}`] : null,
    justify ? stackStyles[`justify-${justify}`] : null,
    wrap ? stackStyles.wrap : null,
    grow ? stackStyles.grow : null,
    GAP(gap),
    PAD(p, `p`),
    PAD(px, `px`),
    PAD(py, `py`),
    className,
  ]
    .filter(Boolean)
    .join(` `)
  return <Component ref={ref} className={cls} style={style} {...rest} />
})
