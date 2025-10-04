import { setElectricConfig } from "@electric-sql/client"

console.log("[Electric Config] __ELECTRIC_SHARD_PORTS__:", __ELECTRIC_SHARD_PORTS__)
console.log("[Electric Config] typeof:", typeof __ELECTRIC_SHARD_PORTS__)

if (typeof __ELECTRIC_SHARD_PORTS__ !== "undefined") {
  console.log("[Electric Config] Setting config with ports:", __ELECTRIC_SHARD_PORTS__)
  setElectricConfig({
    localPortSharding: __ELECTRIC_SHARD_PORTS__,
  })
} else {
  console.log("[Electric Config] Ports undefined, skipping config")
}
