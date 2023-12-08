import React, { Provider, ReactElement, createContext, useCallback, useContext, useEffect, useState } from 'react'
import { ToastContextType, ToastData, ToastId, ToastProps } from './types.toast';
import { createPortal } from 'react-dom';
import { Toast } from './Toast';
import { ToastList } from './ToastList';


const DEFAULT_TOAST_DURATION_MS = 2000;

export const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const { showToast, clearToast } = useContext(ToastContext)!;
  return { showToast, clearToast };
}

/**
 * Generates a unique ID based on date and a random number.
 * @returns {string} - date and random number based UID
 */
const generateUid = function(){
  return Date.now().toString(32) + Math.random().toString(32);
}

export const ToastProvider = (props: { children: ReactElement[] | ReactElement }) => {
  const [ toasts, setToasts ] = useState<ToastData[]>([])
  const showToastFn = useCallback((props: ToastProps) => {
    const newToast: ToastData = {
      id: generateUid(),
      ...props,
      durationInMs: props.durationInMs ?? DEFAULT_TOAST_DURATION_MS,
      dismissable: props.dismissable ?? true,
    }
    setToasts([newToast, ...toasts]);
  }, [toasts]);

  const clearToastFn = () => setToasts([]);

  const removeToast = useCallback((id: ToastId) => {
    const toastIdx = toasts.findIndex((toast) => toast.id === id);
    if (toastIdx < 0) {
      return;
    }
    setToasts([...toasts.slice(0, toastIdx), ...toasts.slice(toastIdx + 1)])
  }, [toasts, setToasts]);

  return (
    <ToastContext.Provider value={{
      toasts: toasts,
      showToast: showToastFn,
      clearToast: clearToastFn
    }}>
      {props.children}
      {createPortal(
        <ToastList toasts={toasts} onDismissToast={removeToast} />,
        document.body,
      )}
    </ToastContext.Provider>
  );
}