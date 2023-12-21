import { type Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { startGeneratingData } from './pg-utils'
import { faker } from '@faker-js/faker'


interface MonitoringMetric {
  timestamp: Date,
  type: 'CPU',
  value: number
}

/**
 * Generates randomized monitoring metric
 */
export function generateMonitoringMetric ({
  minVal,
  maxVal,
  precision = 4
} : {
  minVal: number,
  maxVal: number,
  precision?: number
}): MonitoringMetric {
  return {
    timestamp: new Date(),
    type: 'CPU',
    value: faker.number.float({
      min: minVal,
      max: maxVal,
      precision: precision
    })
  }
}



export async function startGeneratingMonitoringMetrics (pgPool: Pool): Promise<void> {
  await startGeneratingData({
    pgPool: pgPool,
    tableName: 'monitoring',
    rowGenerationQuery: 'INSERT INTO monitoring(id, timestamp, type, value) VALUES($1, $2, $3, $4)',
    valueGenerator: () => {
      const monitoringMetric = generateMonitoringMetric({
        minVal: 42,
        maxVal: 65, 
        precision: 4
      })
      return [
        uuidv4(),
        monitoringMetric.timestamp.toISOString(),
        monitoringMetric.type,
        monitoringMetric.value
      ];
    }
  })
}
