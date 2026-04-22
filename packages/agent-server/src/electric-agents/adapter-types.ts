/**
 * Interfaces for the Electric Agents adapter layer.
 *
 * Layer 2 adapters (one per SDK) implement CreateAdapter to translate
 * SDK events into State Protocol writes via the provided writeEvent callback.
 */

import type { AgentTool, StreamFn } from '@mariozechner/pi-agent-core'

/** A State Protocol event to be written via the adapter's writeEvent callback. */
export interface WriteEvent {
  type: string
  key: string
  value: Record<string, unknown>
  headers: {
    operation: `insert` | `update`
    [key: string]: unknown
  }
}

/** Agent adapter — SDK-agnostic interface for the webhook handler. */
export interface AgentAdapter {
  processMessage: (message: string) => Promise<void>
  steer: (message: string) => void
  isRunning: () => boolean
  dispose: () => void
}

/** Configuration for an agent type (Layer 3 — pure data). */
export interface AgentTypeConfig {
  systemPrompt: string
  model: string
  tools: Array<AgentTool>
}

/** Full agent type definition including registration metadata. */
export interface AgentTypeDefinition {
  registration: {
    name: string
    description: string
  }
  systemPrompt: string
  model: string
  tools: Array<AgentTool>
}

/** Raw stream event as read from the entity's main stream. */
export interface StreamEvent {
  specversion?: string
  source?: string
  id?: string
  timestamp?: string
  type?: string
  key?: string
  value?: Record<string, unknown>
  headers?: {
    operation?: `insert` | `update`
    [key: string]: unknown
  }
}

/** Factory function that each SDK adapter must implement. */
export type CreateAdapter = (opts: {
  entityUrl: string
  epoch: number
  streamEvents: Array<StreamEvent>
  writeEvent: (event: WriteEvent) => Promise<void>
  config: AgentTypeConfig
  streamFn?: StreamFn
}) => AgentAdapter
