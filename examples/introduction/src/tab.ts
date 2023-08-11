import MemoryStorage from 'memorystorage'
import { genUUID } from 'electric-sql/util'

const memoryStorage = new MemoryStorage()
const key = 'electric.intro.tab:id'

export const getOrSetTabId = () => {
  let existingTabId

  try {
    existingTabId = sessionStorage.getItem(key)
  }
  catch {
    existingTabId = memoryStorage.getItem(key)
  }

  if (existingTabId !== null) {
    return existingTabId
  }

  const newTabId = genUUID()
  try {
    sessionStorage.setItem(key, newTabId)
  }
  catch {
    memoryStorage.setItem(key, newTabId)
  }

  return newTabId
}
