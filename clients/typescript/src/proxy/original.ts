import { hasPublicKey, publicKeys } from '../util/keys'

const isInstanceOfSameClass = (
  instance: object,
  candidate?: object
): boolean => {
  if (!candidate) {
    return false
  }

  return candidate.constructor === instance.constructor
}

// Proxy the original, intercepting the properties and methods that
// need to be patched to make the auto coommit notifications work.
//
// See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
// and https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect
// for background on the proxy voodoo.
export const proxyOriginal = (original: any, electric: any): any => {
  return new Proxy(original, {
    has(target, key) {
      return Reflect.has(target, key) || hasPublicKey(electric, key)
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).concat(publicKeys(electric))
    },
    getOwnPropertyDescriptor(target, key) {
      if (hasPublicKey(electric, key)) {
        return Reflect.getOwnPropertyDescriptor(electric, key)
      }

      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key, _receiver) {
      let value: any

      if (hasPublicKey(electric, key)) {
        value = electric[key]

        if (typeof value === 'function') {
          return (...args: any) => {
            const retval: any = Reflect.apply(value, electric, args)

            // Preserve chainability.
            if (isInstanceOfSameClass(electric, retval)) {
              return proxyOriginal(retval._getOriginal(), retval)
            }

            return retval
          }
        }

        return value
      }

      value = target[key]

      if (typeof value === 'function') {
        return (...args: any) => {
          const retval: any = Reflect.apply(value, target, args)

          // Preserve chainability.
          if (isInstanceOfSameClass(target, retval)) {
            electric._setOriginal(retval)

            return proxyOriginal(retval, electric)
          }

          return retval
        }
      }

      return value
    },
  })
}
