import { fetchStarCounts } from '../src/lib/star-count.ts'

export default {
  async load() {
    return await fetchStarCounts()
  }
}
