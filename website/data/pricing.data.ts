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

    // Separate tiers from services
    const tiers = plans.filter(plan => plan.type !== 'service')
    const services = plans.filter(plan => plan.type === 'service')

    return {
      plans,
      tiers,
      services
    }
  }
}