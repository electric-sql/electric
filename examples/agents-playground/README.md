# Electric Agents Playground

A collection of agent coordination patterns built on [Electric Agents](https://electric-sql.com/docs/agents/). Currently includes:

- **Perspectives** -- a manager-worker pattern where a manager agent spawns an optimist and a critic to examine any question from multiple viewpoints, then synthesizes their responses into a balanced analysis.
- **Researcher** -- a deep research analyst that decomposes complex topics into specialist sub-agents, each focused on a distinct sub-question, then synthesizes their findings into a comprehensive response with citations.

## Quick Start

> **Prerequisites:** Node.js 18+, Docker, [Anthropic API key](https://console.anthropic.com/settings/keys)

### 1. Start infrastructure

```bash
# From the monorepo root, start Postgres + Electric + Agent Server
npx electric-ax agents start
```

### 2. Configure and run

```bash
cd examples/agents-playground
cp .env.example .env            # add your ANTHROPIC_API_KEY
pnpm install
pnpm dev
```

The app server starts on port 3000 and registers entity types with the agent server on port 4437.

### 3. Test it

**Perspectives example:**

```bash
# Spawn a perspectives manager
pnpm electric-agents spawn /perspectives/my-analysis

# Send it a question
pnpm electric-agents send /perspectives/my-analysis "Is remote work better than office work?"

# Watch the manager and its workers in real time
pnpm electric-agents observe /perspectives/my-analysis
```

The manager will:

1. Spawn two worker agents (optimist and critic)
2. Each worker analyzes the question from its assigned viewpoint
3. As each worker finishes, the manager is woken with `runFinished`
4. Once both are done, the manager synthesizes a balanced response

**Researcher example:**

```bash
# Spawn a researcher
pnpm electric-agents spawn /researcher/my-research

# Send it a research question
pnpm electric-agents send /researcher/my-research "What are the environmental and economic trade-offs of hydrogen fuel cells vs battery EVs?"

# Watch the researcher and its specialist workers
pnpm electric-agents observe /researcher/my-research
```

The researcher will:

1. Assess whether the question is clear enough to decompose
2. Spawn specialist sub-agents for distinct sub-questions (e.g. environmental impact, economic analysis)
3. Each specialist researches its slice using bash tools
4. As each specialist finishes, the researcher is woken with `runFinished`
5. Once all specialists report back, the researcher synthesizes a comprehensive response with citations

## Architecture

### Perspectives

```
perspectives (manager)
  |
  +-- spawn "worker" (optimist)  --> positive analysis
  +-- spawn "worker" (critic)    --> critical analysis
  |
  +-- synthesize both into balanced response
```

- **Entity registration:** `registerPerspectives(registry)` defines the `perspectives` entity type with a `children` state collection to track spawned workers.
- **Manager handler:** On receiving a message, the manager uses `ctx.useAgent()` with a custom `analyze_question` tool. This tool calls `ctx.spawn('worker', ...)` for each perspective.
- **Worker notification:** Workers are spawned with `wake: 'runFinished'`, so the manager is automatically re-invoked each time a worker completes.
- **State tracking:** The `children` collection tracks each worker's URL.
- **Synthesis:** Once both perspectives report back, the manager's LLM synthesizes the viewpoints into a final balanced response.

### Researcher

```
researcher (coordinator)
  |
  +-- spawn "worker" (specialist-A)  --> focused sub-question research
  +-- spawn "worker" (specialist-B)  --> focused sub-question research
  +-- spawn "worker" (specialist-N)  --> ...
  |
  +-- synthesize all findings into comprehensive response
```

- **Entity registration:** `registerResearcher(registry)` defines the `researcher` entity type with a `children` state collection.
- **Coordinator handler:** The researcher first assesses whether the topic needs decomposition. For complex topics, it uses a `research_with_specialists` tool to spawn specialist workers for distinct sub-questions.
- **Dynamic decomposition:** Unlike perspectives (fixed two workers), the researcher decides at runtime how many specialists to spawn and what each should focus on.
- **Worker notification:** Specialists are spawned with `wake: 'runFinished'`, so the researcher is re-invoked as each finishes.
- **Synthesis:** Once all specialists report back, the researcher synthesizes findings into a structured response with citations.

## Adding More Examples

This playground is designed to grow. To add a new entity pattern:

1. Create a new file in `entities/` (e.g., `entities/my-pattern.ts`)
2. Export a `registerMyPattern(registry: EntityRegistry)` function
3. Import and call it in `server.ts`

See the [durable-agents-playground](https://github.com/electric-sql/durable-streams/tree/main/examples/durable-agents-playground) for more patterns to port: map-reduce, pipeline, debate, peer-review, and others.
