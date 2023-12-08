import { useCallback, useEffect, useState } from "react";
import { ToastData } from "./types.toast";

import './Toast.css';

interface ToastComponentProps extends ToastData {
  onDismiss: () => void
}

const TOAST_HIDE_ANIMATION_DURATION_MS = 200;


export const Toast = ({
  id,
  title,
  message,
  action,
  dismissable,
  durationInMs,
  onDismiss,
}: ToastComponentProps) => {
  const [hiding, setHiding] = useState(false);
  const onAnimatedDismiss = () => setHiding(true);
  const onAction = useCallback(() => {
    action?.actionFn();
    onAnimatedDismiss();
  }, [action?.actionFn, onAnimatedDismiss]);

  useEffect(() => {
    if (!hiding) {
      const maxDuration = Math.max(
        durationInMs - TOAST_HIDE_ANIMATION_DURATION_MS,
        TOAST_HIDE_ANIMATION_DURATION_MS
      )
      const timer = setTimeout(onAnimatedDismiss, maxDuration);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(onDismiss, TOAST_HIDE_ANIMATION_DURATION_MS);
    return () => clearTimeout(timer)
  }, [hiding])

  return (
    <div className="toastContainer">
      <div className="contentContainer">
          {title !== undefined ? <h2>{title}</h2> : null }
          <p>{message}</p>
      </div>
      { action !== undefined ? 
        <button className="actionBtn" onClick={onAction}>
          {action.cta}
        </button>
        : null
      }
      { dismissable ? 
        <button className="dismissBtn" onClick={onAnimatedDismiss}>
          x
        </button>
        : null
      }
    </div>
  )
}