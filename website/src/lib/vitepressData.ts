import type { VitepressDataModule } from '../types/data-loaders'

/**
 * VitePress synthesizes a `data` property on the compiled data module. This
 * helper keeps that assertion in one place.
 */
export function getVitepressData<T>(mod: object): T {
  return (mod as VitepressDataModule<T>).data
}
