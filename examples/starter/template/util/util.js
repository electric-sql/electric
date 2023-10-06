const path = require('path')
const fs = require('fs/promises')

async function findFirstMatchInFile(regex, file, notFoundError) {
  const content = await fs.readFile(file, 'utf8')
  const res = content.match(regex)
  if (res === null) {
    console.error(notFoundError)
    process.exit(1)
  }
  return res[1]
}

async function fetchConfiguredElectricPort() {
  const electricPortRegex =   /ws:\/\/localhost:([0-9]+)/
  const builderFile = path.join(__dirname, '..', 'builder.js')
  const port = await findFirstMatchInFile(electricPortRegex, builderFile, 'Could not find current Electric port in builder.js')
  return Number.parseInt(port)
}

exports.findFirstMatchInFile = findFirstMatchInFile
exports.fetchConfiguredElectricPort = fetchConfiguredElectricPort