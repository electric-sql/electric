/**
 * Run the @durable-streams/benchmarks suite against BENCH_URL.
 * Results land in benchmark-results.json in the cwd.
 */
import { runBenchmarks } from "../../benchmarks/src/index.js"

runBenchmarks({
  baseUrl: process.env.BENCH_URL ?? `http://localhost:4564`,
  environment: process.env.BENCH_ENV ?? `unknown`,
})
