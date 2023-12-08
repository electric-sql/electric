import { useCallback, useEffect, useRef, useState } from "react";
import { ToastData } from "./types.toast";

import './Toast.css';

interface ToastComponentProps extends ToastData {
  onDismiss: () => void
}

const TOAST_HIDE_ANIMATION_DURATION_MS = 150;


export const Toast = ({
  title,
  message,
  action,
  dismissable,
  durationInMs,
  onDismiss,
}: ToastComponentProps) => {
  const dismissFn = useRef(onDismiss);
  const [show, setShow] = useState(false);
  const [hide, setHide] = useState(false);

  const onAnimatedDismiss = () => setHide(true);
  const onAction = useCallback(() => {
    action?.actionFn();
    onAnimatedDismiss();
  }, [action?.actionFn, onAnimatedDismiss]);

  // keep reference to most upd to date callback
  useEffect(() => {
    dismissFn.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!hide) {
      setShow(true);
      const maxDuration = Math.max(
        durationInMs - TOAST_HIDE_ANIMATION_DURATION_MS,
        TOAST_HIDE_ANIMATION_DURATION_MS
      )
      const timer = setTimeout(onAnimatedDismiss, maxDuration);
      return () => clearTimeout(timer);
    }
    
    const timer = setTimeout(() => dismissFn.current(), TOAST_HIDE_ANIMATION_DURATION_MS);
    return () => clearTimeout(timer)
  }, [hide])

  return (
    <div className={"toastContainer" + (show ? " show" : "") + (hide ? " hide" : "")}>
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