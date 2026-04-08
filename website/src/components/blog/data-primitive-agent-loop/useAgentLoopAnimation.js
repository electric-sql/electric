// Composable that owns the reactive state for the agent-loop animation
// and runs the cycle. Components stay presentational — they read the
// refs returned here and render them. Tweak timings and behaviours via
// the SEQUENCE / TIMING constants in ./sequence.js.
//
// The cycle is explicitly started and stopped by the consumer (so the
// animation can be paused when scrolled out of view). `start()` is
// idempotent; `stop()` cancels in-flight waits and animation frames so
// the async cycle loop can unwind cleanly.

import { onBeforeUnmount, ref } from 'vue'

import { SEQUENCE, TIMING, MAX_VISIBLE_SLICES } from './sequence.js'

export function useAgentLoopAnimation() {
  // Live slices on the loop. Each is { id, rotation, fillOpacity, clipHeight }.
  // clipHeight === null means "no clip" (fully visible). 0..1024 means the
  // top-down reveal clip rect is at that height (used for the stream
  // behaviour).
  const slices = ref([])

  // Pulse overlay (used for the LLM_THINKING beat).
  const pulseActive = ref(false)

  // Log entries, newest first. Each is { id, label, time, progress }.
  const logEntries = ref([])

  // Bumped on each pipe trigger so the consumer can re-key the pipe-fill
  // element and restart the CSS keyframe.
  const pipeTick = ref(0)

  // Internal state. `stopped` short-circuits waits/frames so an in-flight
  // runCycle can unwind. `wantRun` captures the caller's intent and is
  // reconciled by `supervise()` — if start() fires while a previous
  // runCycle is still unwinding, the supervisor picks up the new intent
  // and kicks off a fresh cycle as soon as the old one completes.
  let nextId = 0
  let stopped = true
  let wantRun = false
  let supervising = false
  const pendingWaits = new Set()
  const pendingFrames = new Set()

  function id() {
    return ++nextId
  }

  function nowFmt() {
    const d = new Date()
    return d.toLocaleTimeString([], {
      hour12: false,
      hour: `2-digit`,
      minute: `2-digit`,
      second: `2-digit`,
    })
  }

  // A cancellable sleep. When stop() fires, the timer is cleared and the
  // promise is resolved immediately so the awaiting runCycle can unwind.
  function wait(ms) {
    return new Promise((resolve) => {
      if (stopped) {
        resolve()
        return
      }
      const entry = { resolve, timer: null }
      entry.timer = setTimeout(() => {
        pendingWaits.delete(entry)
        resolve()
      }, ms)
      pendingWaits.add(entry)
    })
  }

  function rafLoop(onFrame) {
    return new Promise((resolve) => {
      function tick(time) {
        if (stopped) {
          resolve()
          return
        }
        const done = onFrame(time)
        if (done) {
          resolve()
          return
        }
        const handle = requestAnimationFrame(tick)
        pendingFrames.add(handle)
      }
      const handle = requestAnimationFrame(tick)
      pendingFrames.add(handle)
    })
  }

  function triggerPipe() {
    pipeTick.value += 1
  }

  async function runCycle() {
    let step = 0
    while (!stopped) {
      const event = SEQUENCE[step % SEQUENCE.length]

      if (event.behavior === `pulse`) {
        pulseActive.value = true
        await wait(TIMING.pulseDuration)
        pulseActive.value = false
        step += 1
        continue
      }

      // Push existing slices around the loop by 30deg.
      slices.value = slices.value.map((s) => ({
        ...s,
        rotation: s.rotation + 30,
      }))

      // Add the log entry up front so the bar can be filled in place.
      const entry = {
        id: id(),
        label: event.label,
        time: nowFmt(),
        progress: 0,
      }
      logEntries.value = [entry, ...logEntries.value]

      // Add the new slice at the spawn position.
      const slice = {
        id: id(),
        rotation: 0,
        fillOpacity: 0,
        clipHeight: null,
      }
      slices.value = [slice, ...slices.value]

      if (event.behavior === `instant`) {
        slice.fillOpacity = event.opacity
        // Trigger reactivity for the mutated slice.
        slices.value = [...slices.value]

        await wait(TIMING.instantDelay)
        triggerPipe()

        // Fill the log progress bar over instantLogFill ms.
        const start = performance.now()
        await rafLoop((time) => {
          const elapsed = time - start
          const progress = Math.min(elapsed / TIMING.instantLogFill, 1)
          entry.progress = progress
          logEntries.value = [...logEntries.value]
          return progress >= 1
        })
      } else if (event.behavior === `stream`) {
        slice.fillOpacity = event.opacity
        slice.clipHeight = 0
        slices.value = [...slices.value]

        const start = performance.now()
        let pipeTriggered = false
        await rafLoop((time) => {
          const elapsed = time - start
          const progress = Math.min(elapsed / TIMING.streamDuration, 1)

          slice.clipHeight = progress * 1024
          slices.value = [...slices.value]

          if (progress > TIMING.streamPipeAt && !pipeTriggered) {
            pipeTriggered = true
            triggerPipe()
          }

          if (progress > TIMING.streamLogStart) {
            const logProgress =
              (progress - TIMING.streamLogStart) / (1 - TIMING.streamLogStart)
            entry.progress = logProgress
            logEntries.value = [...logEntries.value]
          }

          return progress >= 1
        })

        // Drop the clip — slice becomes fully visible.
        slice.clipHeight = null
        slices.value = [...slices.value]
      }

      // Once the 12th slice has been filled in, hold briefly so the user
      // can see the full loop, then wipe it and restart the sequence from
      // the top — otherwise new slices would rotate onto existing ones
      // and overwrite their content.
      if (slices.value.length >= MAX_VISIBLE_SLICES) {
        await wait(TIMING.cycleGap)
        slices.value = []
        logEntries.value = []
        step = 0
        continue
      }

      step += 1
      await wait(TIMING.cycleGap)
    }
  }

  // Supervisor: keeps calling runCycle as long as `wantRun` stays true.
  // Only one supervisor runs at a time. If start() is called while the
  // previous runCycle is still unwinding from a stop(), the supervisor's
  // while-loop observes the updated wantRun after the unwind and starts
  // a fresh cycle — so scrolling out and back in reliably restarts it.
  async function supervise() {
    if (supervising) return
    supervising = true
    try {
      while (wantRun) {
        // Clean slate for each cycle.
        stopped = false
        slices.value = []
        logEntries.value = []
        pulseActive.value = false
        await runCycle()
      }
    } finally {
      supervising = false
    }
  }

  function start() {
    wantRun = true
    supervise()
  }

  function stop() {
    wantRun = false
    if (stopped) return
    stopped = true
    // Resolve any pending waits so runCycle can unwind past its awaits.
    pendingWaits.forEach((entry) => {
      clearTimeout(entry.timer)
      entry.resolve()
    })
    pendingWaits.clear()
    pendingFrames.forEach((h) => cancelAnimationFrame(h))
    pendingFrames.clear()
  }

  onBeforeUnmount(stop)

  return {
    slices,
    pulseActive,
    logEntries,
    pipeTick,
    start,
    stop,
  }
}
