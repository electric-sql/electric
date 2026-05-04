import type { CodingAgentAdapter } from './registry'
import { registerAdapter } from './registry'
import { shellQuote } from './shell-quote'

function sanitiseCwd(cwd: string): string {
  return cwd.replace(/\//g, `-`)
}

export const ClaudeAdapter: CodingAgentAdapter = {
  kind: `claude`,
  cliBinary: `claude`,
  defaultEnvVars: [`ANTHROPIC_API_KEY`],

  buildCliInvocation({ prompt: _prompt, nativeSessionId, model }) {
    const args: Array<string> = [
      `--print`,
      `--output-format=stream-json`,
      `--verbose`,
      `--dangerously-skip-permissions`,
    ]
    if (model) args.push(`--model`, model)
    if (nativeSessionId) args.push(`--resume`, nativeSessionId)
    return { args, promptDelivery: `stdin` }
  },

  probeCommand({ homeDir, cwd, sessionId }) {
    const path = `${homeDir}/.claude/projects/${sanitiseCwd(cwd)}/${sessionId}.jsonl`
    return [`test`, `-f`, path]
  },

  materialiseTargetPath({ homeDir, cwd, sessionId }) {
    return `${homeDir}/.claude/projects/${sanitiseCwd(cwd)}/${sessionId}.jsonl`
  },

  captureCommand({ homeDir, cwd, sessionId }) {
    const path = `${homeDir}/.claude/projects/${sanitiseCwd(cwd)}/${sessionId}.jsonl`
    return [
      `sh`,
      `-c`,
      `if [ -f ${shellQuote(path)} ]; then base64 -w 0 ${shellQuote(path)}; fi`,
    ]
  },
}

registerAdapter(ClaudeAdapter)
