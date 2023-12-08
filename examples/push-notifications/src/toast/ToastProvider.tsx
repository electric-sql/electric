import React, { Provider, ReactElement, createContext, useEffect, useState } from 'react'
import { ToastContextType, ToastData, ToastId, ToastProps } from './types.toast';


const DEFAULT_TOAST_DURATION_MS = 2000;

export const ToastContext = createContext<ToastContextType | null>(null);



/**
 * Generates a unique ID based on date and a random number.
 * @returns {string} - date and random number based UID
 */
const generateUid = function(){
  return Date.now().toString(36) + Math.random().toString(36).slice(0, 2);
}

export const ToastProvider = (props: { children: ReactElement[] }) => {
  const [ toasts, setToasts ] = useState<ToastData[]>([])
  const [ visible, setVisible ] = useState(false);
  const showToastFn = ({
    title, message, action,
    durationInMs = DEFAULT_TOAST_DURATION_MS,
    dismissable = true,
  }: ToastProps) => {
    const newToast: ToastData = {
      id: generateUid(),
      title: title,
      message: message,
      durationInMs: durationInMs,
      action: action,
      dismissable: dismissable,
    }
    setToasts([newToast, ...toasts]);
  }
  const clearToastFn = () => setToasts([]);

  const removeToast = (id: ToastId) => {
    const toastIdx = toasts.findIndex((toast) => toast.id === id);
    if (toastIdx < 0) {
      return;
    }
    setToasts([...toasts.slice(0, toastIdx), ...toasts.slice(toastIdx + 1)])
  }

  return (
    <ToastContext.Provider value={{
      toasts: toasts,
      showToast: showToastFn,
      clearToast: clearToastFn
    }}>
      {props.children}
    </ToastContext.Provider>
  );
}