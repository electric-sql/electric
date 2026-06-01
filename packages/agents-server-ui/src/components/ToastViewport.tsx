import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import { subscribeToasts, type ToastMessage } from '../lib/toast'
import { Icon, IconButton, Text } from '../ui'
import styles from './ToastViewport.module.css'

function ToastIcon({
  tone,
}: {
  tone: ToastMessage[`tone`]
}): React.ReactElement {
  const icon =
    tone === `danger`
      ? AlertCircle
      : tone === `warning`
        ? TriangleAlert
        : tone === `success`
          ? CheckCircle2
          : Info
  return <Icon icon={icon} size={2} className={styles.icon} />
}

export function ToastViewport(): React.ReactElement | null {
  const [toasts, setToasts] = useState<Array<ToastMessage>>([])

  useEffect(
    () =>
      subscribeToasts((toast) => {
        setToasts((current) => [...current, toast].slice(-4))
      }),
    []
  )

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts
      .filter((toast) => toast.timeoutMs > 0)
      .map((toast) =>
        window.setTimeout(() => {
          setToasts((current) =>
            current.filter((candidate) => candidate.id !== toast.id)
          )
        }, toast.timeoutMs)
      )
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [toasts])

  if (toasts.length === 0) return null

  return (
    <div className={styles.viewport} role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === `danger` ? `alert` : `status`}
          className={styles.toast}
          data-tone={toast.tone}
        >
          <ToastIcon tone={toast.tone} />
          <div className={styles.content}>
            <Text size={2} weight="medium">
              {toast.title}
            </Text>
            {toast.description && (
              <Text
                size={1}
                tone="muted"
                className={styles.description}
                as="div"
              >
                {toast.description}
              </Text>
            )}
          </div>
          <IconButton
            type="button"
            variant="ghost"
            tone="neutral"
            size={1}
            aria-label="Dismiss notification"
            title="Dismiss notification"
            className={styles.close}
            onClick={() => {
              setToasts((current) =>
                current.filter((candidate) => candidate.id !== toast.id)
              )
            }}
          >
            <Icon icon={X} size={2} />
          </IconButton>
        </div>
      ))}
    </div>
  )
}
