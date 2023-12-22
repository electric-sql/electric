import { type Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { startGeneratingData } from './pg-utils'
import osu from 'node-os-utils';

async function simulateHighCpuLoad(durationMs: number) {
  const startTime = Date.now()
  let lastLoosening = Date.now()

  while (Date.now() - startTime < durationMs) {
    // Perform a computationally intensive task
    Math.pow(Math.random(), Math.random())

    // loosen loop to allow inserts to happen
    if (Date.now() - lastLoosening > 500) {
      lastLoosening = Date.now()
      await new Promise((resolve) => setTimeout(resolve))
    }
  }
}

function simulateHighCpuLoadOverTime({
  minLoadTimeMs = 10 * 1000,
  maxLoadTimeMs = 60 * 1000,
  minTimeBetweenLoadsMs = 20 * 1000,
  maxTimeBetweenLoadsMs = 3 * 60 * 1000
}: {
  minLoadTimeMs?: number
  maxLoadTimeMs?: number,
  minTimeBetweenLoadsMs?: number,
  maxTimeBetweenLoadsMs?: number
}) {
  let lastCpuLoadDurationMs = 0;
  const simulate = () => setTimeout(
    () => {
      lastCpuLoadDurationMs = Math.max(
        minLoadTimeMs,
        Math.random() * maxLoadTimeMs
      );
      simulateHighCpuLoad(lastCpuLoadDurationMs)
    },
    lastCpuLoadDurationMs + Math.max(
      minTimeBetweenLoadsMs,
      Math.random() * maxTimeBetweenLoadsMs
    )
  )
  simulate()
}

export async function startGeneratingMonitoringMetrics (pgPool: Pool): Promise<void> {
  await startGeneratingData({
    pgPool: pgPool,
    tableName: 'monitoring',
    rowGenerationQuery: 'INSERT INTO monitoring(id, timestamp, type, value) VALUES($1, $2, $3, $4)',
    valueGenerator: async () => {
      const cpuUsage = await osu.cpu.usage(20)
      return [
        uuidv4(),
        new Date(),
        'CPU',
        cpuUsage
      ]
    }
  })

  simulateHighCpuLoadOverTime({})
}
