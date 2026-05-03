import { describe, expect, it } from 'vitest'
// Importing the barrel triggers each adapter's self-register.
import { listAdapters } from '../../src'
import type { CodingAgentAdapter } from '../../src/agents/registry'

// Tier 2 Phase D: each adapter's commands that interpolate
// caller-controlled data into shell strings must treat that data as
// data, not code. Generalises the C6 fix (opencode probe/capture/
// postMaterialise) to every adapter, so a future adapter that forgets
// shellQuote fails loudly here.
//
// The contract: when an adversarial sessionId is fed through
// probeCommand / captureCommand / postMaterialiseCommand, the resulting
// argv must not split the adversarial string across shell metacharacters
// — it must appear inside a single-quoted segment. (Adapters that
// validate-then-throw on the input are also acceptable; we catch the
// throw and treat that as "rejected, safe".)

const ADVERSARIAL_IDS = [
  `'; rm -rf /; '`,
  `$(id)`,
  `\`whoami\``,
  `--`,
  `*`,
  `?`,
  `id with space`,
  `\\`,
  // Embedded close-quote + reopen attempt — the textbook escape.
  `'\\''closed`,
]

// Validation-throwing adapters get a clean, valid id to prove the
// command otherwise builds correctly.
const SAFE_ID = `01900000-0000-7000-8000-000000000000`

// Tokenize an sh -c script into the same words sh would see, applying
// single-quote (literal), double-quote (with backslash escape), and
// backslash-escape rules. Returns the parsed words. We accept any
// interior-of-word boundary as "fine" — the goal is to verify the
// adversarial input ends up as one word's data, not as control.
function shTokenize(script: string): Array<string> {
  type Mode =
    | `outside`
    | `in_single`
    | `in_double`
    | `escape_outside`
    | `escape_double`
  let mode: Mode = `outside`
  const words: Array<string> = []
  let cur = ``
  const flush = () => {
    if (cur.length > 0 || mode !== `outside`) {
      words.push(cur)
      cur = ``
    }
  }
  for (let i = 0; i < script.length; i++) {
    const ch = script[i]!
    switch (mode) {
      case `outside`:
        if (ch === `'`) {
          mode = `in_single`
        } else if (ch === `"`) {
          mode = `in_double`
        } else if (ch === `\\`) {
          mode = `escape_outside`
        } else if (
          ch === ` ` ||
          ch === `\t` ||
          ch === `\n` ||
          ch === `;` ||
          ch === `|` ||
          ch === `&` ||
          ch === `(` ||
          ch === `)`
        ) {
          flush()
        } else {
          cur += ch
        }
        break
      case `in_single`:
        if (ch === `'`) mode = `outside`
        else cur += ch
        break
      case `in_double`:
        if (ch === `"`) mode = `outside`
        else if (ch === `\\`) mode = `escape_double`
        else cur += ch
        break
      case `escape_outside`:
        cur += ch
        mode = `outside`
        break
      case `escape_double`:
        // In double quotes, sh only treats \$, \`, \", \\, \<newline>
        // as escapes. Other backslashes are literal; both chars are
        // emitted.
        if (
          ch === `$` ||
          ch === `\`` ||
          ch === `"` ||
          ch === `\\` ||
          ch === `\n`
        ) {
          cur += ch
        } else {
          cur += `\\` + ch
        }
        mode = `in_double`
        break
    }
  }
  flush()
  return words
}

function safeForAdversarial(
  cmd: ReadonlyArray<string>,
  adversarial: string
): boolean {
  // For directly-spawned argv (no `sh -c` wrapper), shell metacharacters
  // are not interpreted — argv elements are literals. Safe by construction.
  if (cmd[0] !== `sh` && cmd[0] !== `/bin/sh`) {
    return true
  }
  // Convention: adapters call sh as `sh -c "<script>"`. The script is
  // cmd[2]. Tokenize it and assert the adversarial input is fully
  // contained within one parsed word's content.
  const script = cmd[2] ?? ``
  if (!script.includes(adversarial)) {
    return true
  }
  const words = shTokenize(script)
  return words.some((w) => w.includes(adversarial))
}

const adapters = listAdapters()

const PROBE_LIKE_FIELDS: Array<{
  field: keyof CodingAgentAdapter
  callable: (
    a: CodingAgentAdapter,
    id: string
  ) => ReadonlyArray<string> | undefined
}> = [
  {
    field: `probeCommand`,
    callable: (a, id) =>
      a.probeCommand?.({ homeDir: `/h`, cwd: `/w`, sessionId: id }),
  },
  {
    field: `captureCommand`,
    callable: (a, id) =>
      a.captureCommand?.({ homeDir: `/h`, cwd: `/w`, sessionId: id }),
  },
  {
    field: `postMaterialiseCommand`,
    callable: (a, id) =>
      a.postMaterialiseCommand?.({ homeDir: `/h`, cwd: `/w`, sessionId: id }),
  },
]

describe(`adapter shell-injection corpus`, () => {
  for (const adapter of adapters) {
    for (const probe of PROBE_LIKE_FIELDS) {
      // Skip if adapter doesn't define this command.
      const sample = probe.callable(adapter, SAFE_ID)
      if (!sample) continue
      it(`${adapter.kind}.${String(probe.field)} treats sessionId as data`, () => {
        for (const adversarial of ADVERSARIAL_IDS) {
          let cmd: ReadonlyArray<string> | undefined
          try {
            cmd = probe.callable(adapter, adversarial)
          } catch {
            // Adapter validates and throws — equivalently safe.
            continue
          }
          if (!cmd) continue
          expect(
            safeForAdversarial(cmd, adversarial),
            `${adapter.kind}.${String(probe.field)} interpolated ` +
              `${JSON.stringify(adversarial)} unsafely; argv: ${JSON.stringify(cmd)}`
          ).toBe(true)
        }
      })
    }
  }
})
