import MemoryStorage from 'memorystorage'

const memoryStorage = new MemoryStorage()

const get = (key) => {
  let itemStr
  let storage

  try {
    itemStr = localStorage.getItem(key)
    storage = localStorage
  }
  catch {
    itemStr = memoryStorage.getItem(key)
    storage = memoryStorage
  }

  if (!itemStr) {
    return null
  }

  const item = JSON.parse(itemStr)
  const now = Date.now()

  if (now > item.expiry) {
    storage.removeItem(key)

    return null
  }

  return item.value
}

const getRaw = (key) => {
  let value

  try {
    value = localStorage.getItem(key)
  }
  catch {
    value = memoryStorage.getItem(key)
  }

  // Note that JSON.parse(null) => null
  return JSON.parse(value)
}

const set = (key, value, ttl) => {
  const now = Date.now()

  const itemStr = JSON.stringify({
    value: value,
    expiry: now + ttl,
  })

  try {
    localStorage.setItem(key, itemStr)
  }
  catch {
    memoryStorage.setItem(key, itemStr)
  }
}

const unset = (key) => {
  try {
    localStorage.removeItem(key)
  }
  catch {
    memoryStorage.removeItem(key)
  }
}

export default {
  get: get,
  getRaw: getRaw,
  set: set,
  unset: unset
}
