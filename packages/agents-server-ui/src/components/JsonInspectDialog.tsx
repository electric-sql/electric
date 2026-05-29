import { X } from 'lucide-react'
import { Dialog, Icon, IconButton } from '../ui'
import styles from './JsonInspectDialog.module.css'

export function JsonInspectDialog({
  open,
  onOpenChange,
  title,
  value,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  value: unknown
}): React.ReactElement {
  const details = inspectDetails(value)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth={680} className={styles.dialog}>
        <div className={styles.header}>
          <div className={styles.headerText}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
          </div>
          <Dialog.Close
            render={
              <IconButton
                type="button"
                size={1}
                variant="ghost"
                tone="neutral"
                round
                aria-label="Close inspector"
                className={styles.close}
              >
                <Icon icon={X} size={2} />
              </IconButton>
            }
          />
        </div>
        {details.length > 0 ? (
          <div className={styles.details}>
            {details.map((detail) => (
              <div key={detail.label} className={styles.detail}>
                <span>{detail.label}</span>
                <strong>{detail.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
        <pre className={styles.pre}>{JSON.stringify(value, null, 2)}</pre>
      </Dialog.Content>
    </Dialog.Root>
  )
}

type InspectDetail = { label: string; value: string }

const DETAIL_KEYS = [
  `kind`,
  `type`,
  `entity_type`,
  `status`,
  `id`,
  `sourceType`,
  `sourceRef`,
  `mode`,
  `scheduleType`,
  `expression`,
  `function_ref`,
  `url`,
  `entity_url`,
  `root`,
] as const

function inspectDetails(value: unknown): Array<InspectDetail> {
  if (!isRecord(value)) return []

  const details: Array<InspectDetail> = []
  for (const key of DETAIL_KEYS) {
    const detail = detailFromKey(value, key)
    if (detail) details.push(detail)
    if (details.length >= 5) break
  }

  if (details.length < 5 && isRecord(value.collections)) {
    details.push({
      label: `Collections`,
      value: Object.keys(value.collections).join(`, `) || `none`,
    })
  }

  if (details.length < 5 && isRecord(value.attrs)) {
    details.push({
      label: `Attrs`,
      value: `${Object.keys(value.attrs).length}`,
    })
  }

  return details.slice(0, 5)
}

function detailFromKey(
  value: Record<string, unknown>,
  key: (typeof DETAIL_KEYS)[number]
): InspectDetail | null {
  const raw = value[key]
  if (
    typeof raw !== `string` &&
    typeof raw !== `number` &&
    typeof raw !== `boolean`
  ) {
    return null
  }
  return { label: detailLabel(key), value: String(raw) }
}

function detailLabel(key: string): string {
  switch (key) {
    case `entity_type`:
      return `Entity type`
    case `sourceType`:
      return `Source type`
    case `sourceRef`:
      return `Source ref`
    case `scheduleType`:
      return `Schedule type`
    case `function_ref`:
      return `Function`
    case `entity_url`:
      return `Entity url`
    default:
      return `${key.charAt(0).toUpperCase()}${key.slice(1)}`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === `object` && value !== null && !Array.isArray(value)
}
