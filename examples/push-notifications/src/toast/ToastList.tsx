import { Toast } from "./Toast"
import { ToastData, ToastId } from "./types.toast"

import './ToastList.css'


export const ToastList = ({
  toasts,
  onDismissToast
}: {
  toasts: ToastData[],
  onDismissToast: (id: ToastId) => void
}) => {
  return (
    <div className="toastList">
      {toasts.map((toast) =>
        <Toast
          key={toast.id}
          {...toast}
          onDismiss={() => onDismissToast(toast.id)}
        />
      )}
    </div>
  )
}