import { useRef, useState } from 'react'
import { Animated, Easing } from 'react-native'

/** Horizontal slide offset (px) a drilling pane animates in/out from. */
const DRILL_OFFSET = 28
const DRILL_DURATION_MS = 180

type DrillDirection = 1 | -1

/**
 * Shared "drill" transition for bottom-sheet submenus — the pane slides
 * + fades 28px horizontally over 180ms whenever the caller navigates
 * between pages. Direction `1` slides in from the right (drilling
 * deeper); `-1` slides in from the left (backing out).
 *
 * The caller owns the page state; it calls `drill(direction)` alongside
 * its `setPage(...)` so the new pane animates in. Used by both
 * `SessionMenu` (signals submenu) and `HomeMenu` (server/type/status
 * submenus).
 */
export function useDrillTransition(): {
  style: {
    opacity: Animated.Value
    transform: Array<{ translateX: Animated.AnimatedInterpolation<number> }>
  }
  drill: (direction: DrillDirection) => void
  reset: () => void
} {
  const [direction, setDirection] = useState<DrillDirection>(1)
  const progress = useRef(new Animated.Value(1)).current

  const drill = (nextDirection: DrillDirection): void => {
    setDirection(nextDirection)
    progress.setValue(0)
    Animated.timing(progress, {
      toValue: 1,
      duration: DRILL_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
  }

  // Snap to the resting state without animating — used when the sheet
  // closes so the next open doesn't flash a mid-transition frame.
  const reset = (): void => {
    progress.setValue(1)
  }

  const style = {
    opacity: progress,
    transform: [
      {
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [direction * DRILL_OFFSET, 0],
        }),
      },
    ],
  }

  return { style, drill, reset }
}
