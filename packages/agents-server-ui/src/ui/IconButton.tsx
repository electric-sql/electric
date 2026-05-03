import { forwardRef } from 'react'
import { Button as BaseButton } from '@base-ui/react/button'
import type { ButtonProps as BaseButtonProps } from '@base-ui/react/button'
import buttonStyles from './Button.module.css'
import iconStyles from './IconButton.module.css'
import type { ButtonSize, ButtonTone, ButtonVariant } from './Button'

type IconButtonProps = Omit<BaseButtonProps, `size`> & {
  size?: ButtonSize
  variant?: ButtonVariant
  tone?: ButtonTone
  /** Render as a circle. Default false (square with rounded corners). */
  round?: boolean
  /** Required for accessibility — describes what the button does. */
  [`aria-label`]: string
}

/**
 * Square button for icon-only triggers. Same tone/variant/size taxonomy
 * as `<Button>`. Replaces `<IconButton>` from `@radix-ui/themes`.
 *
 * Always require `aria-label` since there is no text label.
 */
export const IconButton = forwardRef<HTMLElement, IconButtonProps>(
  function IconButton(
    {
      size = 2,
      variant = `ghost`,
      tone = `neutral`,
      round,
      className,
      ...rest
    },
    ref
  ) {
    const cls = [
      buttonStyles.button,
      buttonStyles[`variant-${variant}`],
      buttonStyles[`tone-${tone}`],
      iconStyles.iconButton,
      iconStyles[`size${size}`],
      round ? iconStyles.round : null,
      className,
    ]
      .filter(Boolean)
      .join(` `)
    return <BaseButton ref={ref} className={cls} {...rest} />
  }
)
