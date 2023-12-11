import { useCallback, useEffect, useRef, useState } from "react";
import { ToastData } from "./types.toast";

import './Toast.css';

interface ToastComponentProps extends ToastData {
  onDismiss: () => void,
  animationDurationMs: number,
}

const TOAST_ANIMATION_DURATION_MS = 150;

export const Toast = ({
  title,
  message,
  action,
  dismissable,
  durationInMs,
  onDismiss,
  animationDurationMs = TOAST_ANIMATION_DURATION_MS,
}: ToastComponentProps) => {
  const dismissFn = useRef(onDismiss);
  const [show, setShow] = useState(false);
  const [hide, setHide] = useState(false);

  const onAnimatedDismiss = () => setHide(true);
  const onAction = useCallback(() => {
    action?.actionFn();
    onAnimatedDismiss();
  }, [action?.actionFn, onAnimatedDismiss]);

  // keep reference to most up to date callback to avoid stale
  // callback calls
  useEffect(() => (dismissFn.current = onDismiss), [onDismiss]);

  useEffect(() => {
    // show in the next animation frame to allow for an entry animation
    if (!hide && !show) {
      const frame = requestAnimationFrame(() => setShow(true));
      return () => cancelAnimationFrame(frame);
    }

    // keep the timer running for the toast to disappear after set duration
    if (!hide) {
      const maxDuration = Math.max(
        durationInMs - animationDurationMs,
        animationDurationMs
      )
      const timer = setTimeout(onAnimatedDismiss, maxDuration);
      return () => clearTimeout(timer);
    }
    
    // once toast is set to be hidden, allow for the animation to run
    const timer = setTimeout(() => dismissFn.current(), animationDurationMs);
    return () => clearTimeout(timer)
  }, [hide, show])

  return (
    <div
      className={"toastContainer" + (show ? " show" : "") + (hide ? " hide" : "")}
      style={{ transitionDuration: `${animationDurationMs}ms` }}>
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