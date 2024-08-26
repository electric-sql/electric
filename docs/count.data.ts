import { fetchStarCounts } from './components/starCount.ts'

export default {
  async load() {
    return await fetchStarCounts()
  }
}
