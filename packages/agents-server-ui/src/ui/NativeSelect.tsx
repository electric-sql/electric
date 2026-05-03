import { forwardRef, type SelectHTMLAttributes } from 'react'
import styles from './NativeSelect.module.css'

type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement>

/**
 * Plain native `<select>` styled to match the Input primitive.
 *
 * Use this when a real `<select>` is preferable to the fancier Base UI
 * `<Select>` — e.g. inside `<form>`s where browser auto-fill, mobile
 * native pickers, or simple keyboard semantics matter more than a
 * customised popover.
 */
export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, ...rest }, ref) {
    const cls = [styles.select, className].filter(Boolean).join(` `)
    return <select ref={ref} className={cls} {...rest} />
  }
)
