import { describe, expect, it, beforeEach } from 'vitest'
import { setElectricConfig, getElectricConfig } from '../src/config'

describe(`ElectricConfig`, () => {
  beforeEach(() => {
    setElectricConfig({})
  })

  it(`should start with empty config`, () => {
    const config = getElectricConfig()
    expect(config).toEqual({})
  })

  it(`should set and get localPortSharding`, () => {
    const ports = [51730, 51731, 51732]
    setElectricConfig({ localPortSharding: ports })
    
    const config = getElectricConfig()
    expect(config.localPortSharding).toEqual(ports)
  })

  it(`should return a copy of the config`, () => {
    const ports = [51730, 51731]
    setElectricConfig({ localPortSharding: ports })
    
    const config1 = getElectricConfig()
    const config2 = getElectricConfig()
    
    expect(config1).toEqual(config2)
    expect(config1).not.toBe(config2)
  })

  it(`should overwrite previous config`, () => {
    setElectricConfig({ localPortSharding: [51730] })
    setElectricConfig({ localPortSharding: [51731] })
    
    const config = getElectricConfig()
    expect(config.localPortSharding).toEqual([51731])
  })

  it(`should allow clearing config`, () => {
    setElectricConfig({ localPortSharding: [51730] })
    setElectricConfig({})
    
    const config = getElectricConfig()
    expect(config.localPortSharding).toBeUndefined()
  })
})
