import { forwardRef } from 'react'
import { Button as BaseButton } from '@base-ui/react/button'
import type { ButtonProps as BaseButtonProps } from '@base-ui/react/button'
import styles from './Button.module.css'

export type ButtonSize = 1 | 2 | 3 | 4
export type ButtonVariant = `solid` | `soft` | `ghost` | `outline`
export type ButtonTone = `neutral` | `accent` | `danger`

interface ButtonProps extends Omit<BaseButtonProps, `size`> {
  size?: ButtonSize
  variant?: ButtonVariant
  tone?: ButtonTone
}

/**
 * Button primitive — replaces `<Button>` from `@radix-ui/themes`.
 *
 * Wraps `@base-ui/react/button` to keep behaviour (focusableWhenDisabled,
 * render-prop, etc.) and adds our `size`/`variant`/`tone` taxonomy on top.
 *
 *   <Button variant="soft" tone="accent" size={2}>Save</Button>
 *
 * Accent solid is the default (matches Radix's primary button).
 */
export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  { size = 2, variant = `solid`, tone = `accent`, className, ...rest },
  ref
) {
  const cls = [
    styles.button,
    styles[`size${size}`],
    styles[`variant-${variant}`],
    styles[`tone-${tone}`],
    className,
  ]
    .filter(Boolean)
    .join(` `)
  return <BaseButton ref={ref} className={cls} {...rest} />
})
