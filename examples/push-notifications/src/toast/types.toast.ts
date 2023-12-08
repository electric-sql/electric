export interface ToastContextType {
  toasts: ToastData[];
  showToast: (props: ToastProps) => void;
  clearToast: () => void;
}

export type ToastId = string;

export interface ToastProps {
  title?: string;
  message: string;
  durationInMs: number;
  action?: ToastAction;
  dismissable: boolean;
}

export interface ToastData extends ToastProps {
  id: ToastId;
}

export interface ToastAction {
  cta: string;
  actionFn: ToastActionFn;
}

export type ToastActionFn = () => void