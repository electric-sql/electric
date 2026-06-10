export type RealtimeProviderId = `openai`

export type RealtimeModelChoice = {
  id: string
  label: string
  description: string
  recommended?: boolean
}

export type RealtimeVoiceChoice = {
  id: string
  label: string
  description: string
  recommended?: boolean
}

export type OpenAIRealtimeReasoningEffort = `low` | `medium` | `high`

export type RealtimeReasoningEffortChoice = {
  id: OpenAIRealtimeReasoningEffort
  label: string
  description: string
  recommended?: boolean
}

export const DEFAULT_OPENAI_REALTIME_MODEL = `gpt-realtime-2`
export const DEFAULT_OPENAI_REALTIME_VOICE = `marin`
export const DEFAULT_OPENAI_REALTIME_REASONING_EFFORT: OpenAIRealtimeReasoningEffort = `low`

export const OPENAI_REALTIME_MODELS = [
  {
    id: `gpt-realtime-2`,
    label: `GPT-Realtime-2`,
    description: `Strongest realtime reasoning, tool use, and instruction following.`,
    recommended: true,
  },
  {
    id: `gpt-realtime-1.5`,
    label: `GPT-Realtime-1.5`,
    description: `Fast, reliable speech-to-speech model for audio in, audio out.`,
  },
  {
    id: `gpt-realtime-mini`,
    label: `GPT-Realtime mini`,
    description: `Cost-efficient realtime voice model.`,
  },
] as const satisfies ReadonlyArray<RealtimeModelChoice>

export const OPENAI_REALTIME_VOICES = [
  {
    id: `marin`,
    label: `Marin`,
    description: `OpenAI recommended voice with the strongest naturalness.`,
    recommended: true,
  },
  {
    id: `cedar`,
    label: `Cedar`,
    description: `OpenAI recommended voice with a distinct, expressive tone.`,
    recommended: true,
  },
  {
    id: `alloy`,
    label: `Alloy`,
    description: `Balanced general-purpose voice.`,
  },
  {
    id: `ash`,
    label: `Ash`,
    description: `Clear general-purpose voice.`,
  },
  {
    id: `ballad`,
    label: `Ballad`,
    description: `Warm general-purpose voice.`,
  },
  {
    id: `coral`,
    label: `Coral`,
    description: `Bright general-purpose voice.`,
  },
  {
    id: `echo`,
    label: `Echo`,
    description: `Steady general-purpose voice.`,
  },
  {
    id: `sage`,
    label: `Sage`,
    description: `Calm general-purpose voice.`,
  },
  {
    id: `shimmer`,
    label: `Shimmer`,
    description: `Light general-purpose voice.`,
  },
  {
    id: `verse`,
    label: `Verse`,
    description: `Expressive general-purpose voice.`,
  },
] as const satisfies ReadonlyArray<RealtimeVoiceChoice>

export const OPENAI_REALTIME_REASONING_EFFORTS = [
  {
    id: `low`,
    label: `Low`,
    description: `Lowest recommended latency for production voice agents.`,
    recommended: true,
  },
  {
    id: `medium`,
    label: `Medium`,
    description: `More reasoning for harder requests, with higher latency.`,
  },
  {
    id: `high`,
    label: `High`,
    description: `Deepest reasoning; use only when latency is acceptable.`,
  },
] as const satisfies ReadonlyArray<RealtimeReasoningEffortChoice>

export function isOpenAIRealtimeModel(value: unknown): value is string {
  return (
    typeof value === `string` &&
    OPENAI_REALTIME_MODELS.some((model) => model.id === value)
  )
}

export function isOpenAIRealtimeVoice(value: unknown): value is string {
  return (
    typeof value === `string` &&
    OPENAI_REALTIME_VOICES.some((voice) => voice.id === value)
  )
}

export function isOpenAIRealtimeReasoningEffort(
  value: unknown
): value is OpenAIRealtimeReasoningEffort {
  return (
    typeof value === `string` &&
    OPENAI_REALTIME_REASONING_EFFORTS.some((effort) => effort.id === value)
  )
}
