import { useEffect, useState } from 'react'
import { SharedTimer } from '../utils/timer'

const locale = 'en'
const second = 1_000
const minute = 60 * second

type TimeOpts = {
  hour: '2-digit'
  minute: '2-digit'
  second: undefined
}

type DateOpts = TimeOpts & {
  year: 'numeric'
  month: 'short'
  day: 'numeric'
}

const timeOpts: TimeOpts = {
  hour: '2-digit',
  minute: '2-digit',
  second: undefined,
}

const dateOpts: DateOpts = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  ...timeOpts,
}

const timer = new SharedTimer()

function isSameDay(date1: Date, now: Date): boolean {
  return date1.toDateString() === now.toDateString()
}

function isYesterday(target: Date, now: Date): boolean {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  return target.toDateString() === yesterday.toDateString()
}

export function formatRelativeTime(target: Date | undefined): string {
  if (target === undefined) {
    return 'now'
  }

  const now = new Date()
  const diff = target.getTime() - now.getTime()
  const absDiff = Math.abs(diff)

  // Under a minute: 'now'
  if (absDiff < minute) {
    return 'now'
  }

  if (isSameDay(target, now)) {
    return target.toLocaleTimeString(locale, timeOpts)
  }

  if (isYesterday(target, now)) {
    const time = target.toLocaleTimeString(locale, timeOpts)

    return `Yesterday at ${time}`
  }

  return target.toLocaleString(locale, dateOpts)
}

export function useRelativeTime(date: Date | undefined): string {
  const initialValue = formatRelativeTime(date)
  const [relativeTime, setRelativeTime] = useState(initialValue)

  const updateTime = () => {
    const value = formatRelativeTime(date)

    setRelativeTime(value)
  }

  useEffect(() => {
    updateTime()

    return timer.subscribe(updateTime)
  }, [date])

  return relativeTime
}
