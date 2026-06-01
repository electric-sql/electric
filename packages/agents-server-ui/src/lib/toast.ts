export type ToastTone = `danger` | `info` | `success` | `warning`

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  timeoutMs?: number
}

export interface ToastMessage
  extends Required<Omit<ToastInput, `description`>> {
  id: string
  createdAt: number
  description?: string
}

type ToastListener = (toast: ToastMessage) => void

const listeners = new Set<ToastListener>()
let nextToastId = 0

export function showToast(input: ToastInput): string {
  const id = `toast:${Date.now()}:${nextToastId++}`
  const toast: ToastMessage = {
    id,
    title: input.title,
    description: input.description,
    tone: input.tone ?? `info`,
    timeoutMs: input.timeoutMs ?? 7000,
    createdAt: Date.now(),
  }
  for (const listener of listeners) listener(toast)
  return id
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
