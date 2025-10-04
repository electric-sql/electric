export interface ElectricConfig {
  localPortSharding?: number[]
}

let globalConfig: ElectricConfig = {}

export function setElectricConfig(config: ElectricConfig): void {
  globalConfig = { ...config }
}

export function getElectricConfig(): ElectricConfig {
  return { ...globalConfig }
}
