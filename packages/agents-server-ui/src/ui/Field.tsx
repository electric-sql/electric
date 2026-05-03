import { Field as BaseField } from '@base-ui/react/field'
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
 * Labelled form field — wraps `@base-ui/react/field`.
 *
 * `<Field label="Name" required description="Optional explanation">
 *    <Input ... />
 *  </Field>`
 *
 * Base UI's Field automatically wires `aria-labelledby`/`aria-describedby`
 * between the label, description, error, and the rendered control via
 * Field.Control (or the input's id, when used with native inputs).
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
    <BaseField.Root className={cls}>
      <BaseField.Label className={styles.label}>
        {label}
        {required && <span className={styles.required}>*</span>}
      </BaseField.Label>
      {children}
      {description && (
        <BaseField.Description className={styles.description}>
          {description}
        </BaseField.Description>
      )}
      {error && (
        <BaseField.Error className={styles.error}>{error}</BaseField.Error>
      )}
    </BaseField.Root>
  )
}
