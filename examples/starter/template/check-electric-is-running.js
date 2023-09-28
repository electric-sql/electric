const { fetchHostPortElectric } = require('./db/util.js')
const { fetchConfiguredElectricPort } = require('./util/util.js')

async function checkElectricIsRunning() {
  const port = fetchHostPortElectric() // will raise an error if Electric is not running
  
  // Check that the port on which Electric is running
  // is the same as the port to which the app will connect
  const configuredPort = await fetchConfiguredElectricPort()
  
  if (configuredPort !== port) {
    console.error(
      '\x1b[31m',
      `Your application is configured to connect to Electric on port ${configuredPort} ` +
      `but your instance of Electric is running on port ${port}`
      )
      process.exit(1)
    }
}

checkElectricIsRunning()