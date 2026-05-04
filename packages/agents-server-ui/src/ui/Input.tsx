import { forwardRef } from 'react'
import { Input as BaseInput } from '@base-ui/react/input'
import type { InputProps as BaseInputProps } from '@base-ui/react/input'
import styles from './Input.module.css'

export type InputSize = 1 | 2 | 3

interface InputProps extends Omit<BaseInputProps, `size`> {
  size?: InputSize
  /** Use the monospace font (handy for ids, paths, JSON snippets) */
  mono?: boolean
}

/**
 * Single-line input — wraps `@base-ui/react/input`.
 *
 * Pair with `<Field>` for a labelled/described control. Replaces the
 * ad-hoc inline-styled `<input>` blocks across the app.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 2, mono, className, ...rest },
  ref
) {
  const cls = [
    styles.input,
    styles[`size${size}`],
    mono ? styles.mono : null,
    className,
  ]
    .filter(Boolean)
    .join(` `)
  return <BaseInput ref={ref} className={cls} {...rest} />
})
