import type { ReactNode } from 'react'
import styles from './Field.module.css'

interface FieldProps {
  label: ReactNode
  required?: boolean
  description?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * Labelled form field — visual layout helper.
 *
 *   <Field label="Name" required description="Optional explanation">
 *     <Input ... />
 *   </Field>
 *
 * Provides consistent label/description/error markup. Aria-wiring to the
 * underlying control is the consumer's responsibility (pass `id` /
 * `aria-describedby` on the input) — the design-system Input/Textarea
 * primitives don't yet expose a Field.Control slot.
 */
export function Field({
  label,
  required,
  description,
  error,
  children,
  className,
}: FieldProps): React.ReactElement {
  const cls = [styles.root, className].filter(Boolean).join(` `)
  return (
    <div className={cls}>
      <span className={styles.label}>
        {label}
        {required && <span className={styles.required}>*</span>}
      </span>
      {children}
      {description && <span className={styles.description}>{description}</span>}
      {error && <span className={styles.error}>{error}</span>}
    </div>
  )
}
