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
const dbUser = 'postgres'
const proxyPassword = 'proxy_password'

// URL to use when connecting to the proxy from the host OS
const DATABASE_URL = buildDatabaseURL(dbUser, proxyPassword, 'localhost', proxyPort, appName)

// URL to use when connecting to the proxy from a Docker container. This is used when `psql` is exec'd inside the
// `postgres` service's container to connect to the poxy running in the `electric` service's container.
const CONTAINER_DATABASE_URL = buildDatabaseURL(dbUser, proxyPassword, 'electric', 65432, appName)

// URL to display in the terminal for informational purposes. It omits the password but is still a valid URL that can be
// passed to `psql` running on the host OS.
const PUBLIC_DATABASE_URL = buildDatabaseURL(dbUser, null, 'localhost', proxyPort, appName)

function buildDatabaseURL(user, password, host, port, dbName) {
  let url = 'postgresql://' + user
  if (password) {
    url += ':' + password
  }
  url += '@' + host + ':' + port + '/' + dbName
  return url
}

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
