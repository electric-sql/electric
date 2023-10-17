const fs = require('fs')
const path = require('path')
const shell = require('shelljs')
shell.config.silent = true // don't log output of child processes

// If we are running the docker compose file,
// the container running `electric` service will be exposing
// the proxy port which should be used for all DB connections
// that intend to use the DDLX syntax extension of SQL.
const appName = fetchAppName() ?? 'electric'
const proxyPort = fetchHostProxyPortElectric() ?? 65432
const DEFAULT_URL = `postgresql://electric:password@localhost:${proxyPort}/${appName}`
const DATABASE_URL = process.env.DATABASE_URL || DEFAULT_URL
const PUBLIC_DATABASE_URL = DATABASE_URL.split('@')[1]

const urlComponents = DATABASE_URL.split('/')
const DATABASE_NAME = urlComponents[urlComponents.length-1]

function error(err) {
  console.error('\x1b[31m', err, '\x1b[0m')
  process.exit(1)
}

function fetchHostPortElectric() {
  return fetchHostPort(`${appName}-electric-1`, 5133, 'Electric')
}

function fetchHostProxyPortElectric() {
  return fetchHostPort(`${appName}-electric-1`, 65432, 'Electric')
}

// Returns the host port to which the `containerPort` of the `container` is bound.
// Returns undefined if the port is not bound or container does not exist.
function fetchHostPort(container, containerPort, service) {
  const output = shell.exec(`docker inspect --format='{{(index (index .NetworkSettings.Ports "${containerPort}/tcp") 0).HostPort}}' ${container}`)
  if (output.code !== 0) {
    // Electric is not running for this app
    error(`${service} appears not to be running for this app.\nDocker container ${container} not running.`)
  }
  const port = parseInt(output)
  if (!isNaN(port)) {
    return port
  }
}

// Reads the app name from the backend/.envrc file
function fetchAppName() {
  const envrcFile = path.join(__dirname, '..', 'backend', 'compose', '.envrc')
  const envrc = fs.readFileSync(envrcFile, 'utf8')

  let appName = undefined

  envrc
  .split(/\r?\n/) // split lines
  .reverse() // in case the app name would be defined several times
  .find(line => {
    const match = line.match(/^(export APP_NAME=)(.*)/)
    if (match) {
      appName = match[2]
      return true
    }
    return false
  })

  return appName
}

exports.DATABASE_URL = DATABASE_URL
exports.CONTAINER_DATABASE_URL = CONTAINER_DATABASE_URL
exports.PUBLIC_DATABASE_URL = PUBLIC_DATABASE_URL
exports.fetchHostPortElectric = fetchHostPortElectric
exports.fetchHostProxyPortElectric = fetchHostProxyPortElectric
