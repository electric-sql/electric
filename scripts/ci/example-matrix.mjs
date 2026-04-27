#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'

const repoRoot = execFileSync(`git`, [`rev-parse`, `--show-toplevel`], {
  encoding: `utf8`,
}).trim()

const examples = [
  {
    name: `yjs`,
    path: `examples/yjs`,
    testFolder: `.shared`,
    productionUrl: `https://yjs.examples.electric-sql.com`,
    deployOnChanges: true,
    deployAll: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `linearlite-read-only`,
    path: `examples/linearlite-read-only`,
    testFolder: `.shared`,
    productionUrl: `https://linearlite-read-only.examples.electric-sql.com`,
    deployOnChanges: true,
    deployAll: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `write-patterns`,
    path: `examples/write-patterns`,
    testFolder: `.shared`,
    productionUrl: `https://write-patterns.examples.electric-sql.com`,
    deployOnChanges: true,
    deployAll: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `todo-app`,
    path: `examples/todo-app`,
    testFolder: `.shared`,
    productionUrl: `https://todo-app.examples.electric-sql.com`,
    deployOnChanges: true,
    deployAll: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `proxy-auth`,
    path: `examples/proxy-auth`,
    testFolder: `.shared`,
    productionUrl: `https://proxy-auth.examples.electric-sql.com/?org_id=1`,
    deployOnChanges: true,
    deployAll: true,
    teardown: true,
    productionTest: true,
  },
  {
    name: `phoenix-liveview`,
    path: `examples/phoenix-liveview`,
    testFolder: `phoenix-liveview`,
    productionUrl: `https://phoenix-liveview.examples.electric-sql.com`,
    deployOnChanges: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `tanstack`,
    path: `examples/tanstack`,
    testFolder: `tanstack`,
    productionUrl: `https://tanstack.examples.electric-sql.com`,
    deployOnChanges: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `remix`,
    path: `examples/remix`,
    testFolder: `remix`,
    productionUrl: `https://remix.examples.electric-sql.com`,
    deployOnChanges: true,
    deployAll: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `react`,
    path: `examples/react`,
    testFolder: `.shared`,
    productionUrl: `https://react.examples.electric-sql.com`,
    deployOnChanges: true,
    deployAll: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `burn`,
    path: `examples/burn`,
    testFolder: `burn`,
    productionUrl: `https://burn.examples.electric-sql.com`,
    deployOnChanges: true,
    deployAll: true,
    teardown: true,
    deployTest: true,
    productionTest: true,
  },
  {
    name: `tanstack-db-web-starter`,
    path: `examples/tanstack-db-web-starter`,
    deployOnChanges: true,
    deployAll: true,
  },
  {
    name: `linearlite`,
    testFolder: `.shared`,
    productionUrl: `https://linearlite.examples.electric-sql.com`,
    productionTest: true,
  },
  {
    name: `notes`,
    testFolder: `.shared`,
    productionUrl: `https://notes.examples.electric-sql.com`,
    productionTest: true,
  },
  {
    name: `pixel-art`,
    testFolder: `.shared`,
    productionUrl: `https://pixel-art.examples.electric-sql.com`,
    productionTest: true,
  },
  {
    name: `ai-chat`,
    testFolder: `.shared`,
    productionUrl: `https://electric-ai-chat.examples.electric-sql.com`,
    productionTest: true,
  },
]

const mode = process.argv[2]
const selectors = {
  deployable: (example) => example.deployOnChanges,
  deployAll: (example) => example.deployAll,
  teardown: (example) => example.teardown,
  productionTest: (example) => example.productionTest,
}

const selectedExamples = selectExamples(mode)
const matrix = {
  example: selectedExamples.map((example) => ({
    name: example.name,
    path: example.path ?? ``,
    test_folder: example.testFolder ?? ``,
    deploy_test_folder: example.deployTest ? example.testFolder : ``,
    production_url: example.productionUrl ?? ``,
  })),
}

const outputs = {
  matrix: JSON.stringify(matrix),
  has_examples: String(matrix.example.length > 0),
}

writeOutputs(outputs)
console.log(JSON.stringify({ mode, ...outputs }, null, 2))

function selectExamples(selectedMode) {
  if (selectedMode === `changed-deployable`) {
    const changedExampleNames = new Set(changedExamples())
    return examples.filter(
      (example) =>
        example.deployOnChanges && changedExampleNames.has(example.name)
    )
  }

  const selector = selectors[selectedMode]
  if (!selector) {
    throw new Error(
      `Usage: example-matrix.mjs changed-deployable|deployAll|teardown|productionTest`
    )
  }

  return examples.filter(selector)
}

function changedExamples() {
  const base = process.env.BASE_SHA

  if (!base || /^0+$/.test(base)) {
    return examples
      .filter((example) => example.deployOnChanges)
      .map((example) => example.name)
  }

  try {
    run(`git`, [`rev-parse`, `--verify`, `${base}^{commit}`])
    return Array.from(
      new Set(
        run(`git`, [`diff`, `--name-only`, base, `--`, `examples`])
          .split(`\n`)
          .map((file) => file.trim().split(`/`)[1])
          .filter(Boolean)
      )
    )
  } catch {
    return examples
      .filter((example) => example.deployOnChanges)
      .map((example) => example.name)
  }
}

function writeOutputs(outputs) {
  const outputFile = process.env.GITHUB_OUTPUT
  if (!outputFile) {
    return
  }

  appendFileSync(
    outputFile,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join(`\n`) + `\n`
  )
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: `utf8`,
    stdio: [`ignore`, `pipe`, `pipe`],
  })
}
