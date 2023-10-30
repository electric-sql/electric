const fs = require('fs/promises')
const path = require('path')
const { spawn } = require('child_process')
const process = require('process')

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

async function fetchConfiguredElectricProxyPort() {
  const proxyPortRegex = /export ELECTRIC_PROXY_PORT=([0-9]+)/
  const builderFile = path.join(__dirname, '..', 'backend', 'compose', '.envrc')
  const port = await findFirstMatchInFile(proxyPortRegex, builderFile, "Could not find Electric's current proxy port in .envrc")
  return Number.parseInt(port)
}

const envrcFile = path.join(__dirname, '../backend/compose/.envrc')
const composeFile = path.join(__dirname, '../backend/compose/docker-compose.yaml')

function dockerCompose(command, userArgs, callback) {
  const args = ['compose', '--ansi', 'always', '--env-file', envrcFile, '-f',  composeFile, command, ...userArgs]
  const proc = spawn('docker', args, {stdio: 'inherit'})
  if (callback) { proc.on('exit', callback) }
}

exports.findFirstMatchInFile = findFirstMatchInFile
exports.fetchConfiguredElectricPort = fetchConfiguredElectricPort
exports.fetchConfiguredElectricProxyPort = fetchConfiguredElectricProxyPort
exports.dockerCompose = dockerCompose
