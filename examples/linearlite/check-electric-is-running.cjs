const { fetchHostPortElectric, fetchHostProxyPortElectric } = require('./db/util.cjs')
const { fetchConfiguredElectricPort, fetchConfiguredElectricProxyPort } = require('./util/util.cjs')

async function checkElectricIsRunning() {
  const port = fetchHostPortElectric() // will raise an error if Electric is not running
  
  // Check that the port on which Electric is running
  // is the same as the port to which the app will connect
  const configuredPort = await fetchConfiguredElectricPort()
  
  if (configuredPort !== port) {
    console.error(
      '\x1b[31m',
      `Your application is configured to connect to Electric on port ${configuredPort} ` +
      `but your instance of Electric is running on port ${port}`,
      '\x1b[0m'
    )
    process.exit(1)
  }

  // Also check that the proxy port is configured correctly
  const proxyPort = fetchHostProxyPortElectric()
  const configuredProxyPort = await fetchConfiguredElectricProxyPort()
  if (configuredProxyPort !== proxyPort) {
    console.error(
      '\x1b[31m',
      `Your application is configured to connect to Electric's DB proxy on port ${configuredProxyPort} ` +
      `but your instance of Electric is running the DB proxy on port ${proxyPort}`,
      '\x1b[0m'
    )
  }
}

checkElectricIsRunning()
