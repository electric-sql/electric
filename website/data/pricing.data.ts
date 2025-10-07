import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'

export default {
  watch: ['./plans/*.yaml'],

  load(files) {
    const plans = files.map((file) => {
      const slug = path.basename(file, '.yaml')
      const contents = fs.readFileSync(file, 'utf-8')
      const data = parse(contents)
      
      return {
        slug,
        ...data
      }
    }).sort((a, b) => {
      return (a.order || 999) - (b.order || 999)
    })

    // Filter by type
    const tiers = plans.filter(plan => plan.type === 'tier')
    const services = plans.filter(plan => plan.type === 'service')
    const enterprise = plans.filter(plan => plan.type === 'enterprise')
    const comparisonPlans = plans.filter(plan => plan.type === 'tier' || plan.type === 'enterprise')

    return {
      plans,
      tiers,
      services,
      enterprise,
      comparisonPlans
    }
  }
}