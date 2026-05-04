import { forwardRef, type TextareaHTMLAttributes } from 'react'
import inputStyles from './Input.module.css'
import type { InputSize } from './Input'

interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, `size`> {
  size?: InputSize
  mono?: boolean
}

/**
 * Multi-line text input. Base UI doesn't ship a textarea primitive —
 * this is a plain `<textarea>` wired to the same Input.module.css so it
 * inherits visual styling, focus ring, sizes, and disabled state.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ size = 2, mono, className, ...rest }, ref) {
    const cls = [
      inputStyles.input,
      inputStyles.textarea,
      inputStyles[`size${size}`],
      mono ? inputStyles.mono : null,
      className,
    ]
      .filter(Boolean)
      .join(` `)
    return <textarea ref={ref} className={cls} {...rest} />
  }
)
