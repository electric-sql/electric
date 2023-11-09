import { useState } from 'react'
import { randomValue } from '../../../util/random.js'

/**
 * Utility hook for a random value that sets the value to a random
 * string on create and provides an update function that generates
 * and assigns the value to a new random string.
 */
const useRandom = () => {
  const [value, _setValue] = useState<string>(randomValue())
  const setRandomValue = () => _setValue(randomValue())

  return [value, setRandomValue] as const
}

export default useRandom
