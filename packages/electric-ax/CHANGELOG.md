# electric-ax

## 0.1.18

### Patch Changes

- b16ef14: fix: don't show a stale error before the first API key prompt when no key is configured
- Updated dependencies [65f0cf0]
- Updated dependencies [f509387]
- Updated dependencies [f509387]
- Updated dependencies [28d127b]
- Updated dependencies [6399147]
- Updated dependencies [a3cee92]
- Updated dependencies [92a332e]
  - @electric-ax/agents@0.2.5
  - @electric-ax/agents-runtime@0.1.3
  - @electric-sql/client@1.5.17

## 0.1.17

### Patch Changes

- 4d50347: Bind the local built-in agents server to all interfaces by default so Docker-backed quickstart coordinators can reach Horton webhooks via host.docker.internal.

## 0.1.16

### Patch Changes

- 1aec196: feat: CLI quickstart readability and clarity improvements
- Updated dependencies [1aec196]
  - @electric-ax/agents@0.2.4

## 0.1.15

### Patch Changes

- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
  - @electric-ax/agents-runtime@0.1.2
  - @electric-sql/client@1.5.16
  - @electric-ax/agents@0.2.3

## 0.1.14

### Patch Changes

- 5fec5f1: Replace the abrupt `ANTHROPIC_API_KEY is required` fatal error in `agents quickstart` and `agents start-builtin` with a friendly interactive prompt that explains how the key is used (it never leaves the local machine) and lets the user choose between setting up `.env` manually or pasting the key once to have the CLI write `.env` for them. Non-interactive runs still fail fast with the original error.

## 0.1.13

### Patch Changes

- b0af010: Fix CLI command references and package dependencies for agents chat starter.
- Updated dependencies [4d8e452]
- Updated dependencies [b0af010]
- Updated dependencies [b0af010]
  - @electric-ax/agents@0.2.2

## 0.1.12

### Patch Changes

- 125c276: Improve Horton's onboarding: add warm greeting for initial messages and present multiple onboarding paths instead of defaulting to the quickstart skill.
- Updated dependencies [125c276]
- Updated dependencies [e0b588f]
  - @electric-ax/agents@0.2.1
  - @electric-ax/agents-runtime@0.1.1

## 0.1.11

### Patch Changes

- Updated dependencies [89debcf]
- Updated dependencies [491ba04]
- Updated dependencies [4fc022b]
- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents@0.2.0
  - @electric-ax/agents-runtime@0.1.0

## 0.1.10

### Patch Changes

- Updated dependencies [4801e76]
  - @electric-ax/agents@0.1.5

## 0.1.9

### Patch Changes

- 1d6e728: fix: ensure docker-compose has a correct reference

## 0.1.8

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4
  - @electric-ax/agents@0.1.4

## 0.1.7

### Patch Changes

- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3
  - @electric-ax/agents@0.1.3

## 0.1.6

### Patch Changes

- 7652bdc: Block `electric agent quickstart` before startup when no Anthropic API key is available.

## 0.1.5

### Patch Changes

- Updated dependencies [1786ee6]
  - @electric-ax/agents@0.1.2

## 0.1.4

### Patch Changes

- 097f2c4: Fix postgres 18 docker volume mount path to use `/var/lib/postgresql` instead of `/var/lib/postgresql/data`
- Updated dependencies [097f2c4]
- Updated dependencies [46e0a75]
  - @electric-ax/agents-runtime@0.0.2
  - @electric-ax/agents@0.1.1

## 0.1.3

### Patch Changes

- 196d55b: Fix postgres 18 docker volume mount path to use `/var/lib/postgresql` instead of `/var/lib/postgresql/data`

## 0.1.2

### Patch Changes

- 3026244: fix: packaging was missing builtin agents start script due to a split

## 0.1.1

### Patch Changes

- 2cc77cb: fix: ensure stable name for the started service
