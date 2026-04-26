import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import type {
  GlobalPricingConfig,
  PlanYamlRow,
} from '../src/types/data-loaders'

function parseGlobalPricingConfig(raw: string): GlobalPricingConfig {
  return parse(raw) as GlobalPricingConfig
}

function parsePlanYaml(raw: string): PlanYamlRow {
  return parse(raw) as PlanYamlRow
}

export default {
  watch: [`./plans/*.yaml`, `./pricing.yaml`],

  load(files: string[]) {
    // Separate global config from plan files
    const configFile = files.find(
      (f) => f.endsWith(`pricing.yaml`) && !f.includes(`plans/`)
    )!
    const planFiles = files.filter((f) => f !== configFile)

    const config = parseGlobalPricingConfig(
      fs.readFileSync(configFile, `utf-8`)
    )

    const plans = planFiles
      .map((file) => {
        const slug = path.basename(file, `.yaml`)
        const data = parsePlanYaml(fs.readFileSync(file, `utf-8`))

        // Derive effective rates for tier plans
        if (
          data.type === `tier` &&
          typeof data.discountPercent === `number` &&
          config.baseRates
        ) {
          const discount = data.discountPercent / 100
          data.effectiveWriteRate = +(
            config.baseRates.writesPerMillion *
            (1 - discount)
          ).toFixed(4)
          data.effectiveRetentionRate = +(
            config.baseRates.retentionPerGBMonth *
            (1 - discount)
          ).toFixed(4)
        }

        return { slug, ...data }
      })
      .sort((a, b) => (a.order || 999) - (b.order || 999))

    const tiers = plans.filter((p) => p.type === `tier`)
    const services = plans.filter((p) => p.type === `service`)
    const enterprise = plans.filter((p) => p.type === `enterprise`)
    const comparisonPlans = plans.filter(
      (p) => p.type === `tier` || p.type === `enterprise`
    )

    return { config, plans, tiers, services, enterprise, comparisonPlans }
  },
}
