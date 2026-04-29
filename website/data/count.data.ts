import { fetchStarCounts } from '../src/lib/star-count'

export default {
  async load() {
    return await fetchStarCounts()
  },
}
