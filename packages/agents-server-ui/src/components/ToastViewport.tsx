import { useEffect } from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { subscribeToasts, type ToastTone } from '../lib/toast'
import { Icon } from '../ui'
import styles from './ToastViewport.module.css'

type ToastData = {
  tone: ToastTone
}

const TOAST_TONES: ReadonlySet<string> = new Set([
  `danger`,
  `info`,
  `success`,
  `warning`,
])

function toastTone(toast: BaseToast.Root.ToastObject<ToastData>): ToastTone {
  if (toast.data?.tone) return toast.data.tone
  if (toast.type && TOAST_TONES.has(toast.type)) return toast.type as ToastTone
  return `info`
}

function ToastIcon({ tone }: { tone: ToastTone }): React.ReactElement {
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

function ToastEventBridge(): null {
  const toastManager = BaseToast.useToastManager()

  useEffect(
    () =>
      subscribeToasts((toast) => {
        toastManager.add<ToastData>({
          id: toast.id,
          title: toast.title,
          description: toast.description,
          timeout: toast.timeoutMs,
          type: toast.tone,
          priority: toast.tone === `danger` ? `high` : `low`,
          data: {
            tone: toast.tone,
          },
        })
      }),
    [toastManager]
  )

  return null
}

function ToastList(): React.ReactElement {
  const { toasts } = BaseToast.useToastManager()

  return (
    <>
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast as BaseToast.Root.ToastObject<ToastData>}
        />
      ))}
    </>
  )
}

function ToastItem({
  toast,
}: {
  toast: BaseToast.Root.ToastObject<ToastData>
}): React.ReactElement {
  const tone = toastTone(toast)

  return (
    <BaseToast.Root
      toast={toast}
      swipeDirection="right"
      className={styles.toast}
      data-tone={tone}
    >
      <BaseToast.Content className={styles.content}>
        <ToastIcon tone={tone} />
        <div className={styles.text}>
          <BaseToast.Title className={styles.title} />
          {toast.description && (
            <BaseToast.Description className={styles.description} />
          )}
        </div>
        <BaseToast.Close
          type="button"
          aria-label="Dismiss notification"
          title="Dismiss notification"
          className={styles.close}
        >
          <Icon icon={X} size={2} />
        </BaseToast.Close>
      </BaseToast.Content>
    </BaseToast.Root>
  )
}

export function ToastProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  return (
    <BaseToast.Provider limit={4} timeout={7000}>
      {children}
      <ToastEventBridge />
      <BaseToast.Portal>
        <BaseToast.Viewport
          className={styles.viewport}
          aria-label="Notifications"
        >
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}
