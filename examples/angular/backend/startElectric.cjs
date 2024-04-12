const shell = require('shelljs')

let db = process.env.DATABASE_URL
let electricPort = process.env.ELECTRIC_PORT ?? 5133
let electricProxyPort = process.env.ELECTRIC_PROXY_PORT ?? 65432

let args = process.argv.slice(2)

while (args.length > 0) {
  // There are arguments to parse
  const flag = args[0]
  const value = args[1]

  args = args.slice(2)

  const checkValue = () => {
    if (typeof value === 'undefined') {
      error(`Missing value for option '${flag}'.`)
    }
  }

  switch (flag) {
    case '-db':
      checkValue()
      db = value
      break
    case '--electric-port':
      checkValue()
      electricPort = parsePort(value)
      break
    case '--electric-proxy-port':
      checkValue()
      electricProxyPort = parsePort(value)
      break
    default:
      error(`Unrecognized option: '${flag}'.`)
  }
}

function parsePort(port) {
  // checks that the number is between 0 and 65535
  const portRegex = /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/
  if (!portRegex.test(port)) {
    error(`Invalid port '${port}. Port should be between 0 and 65535.'`)
  }
  return port
}

if (db === undefined) {
  console.error(`Database URL is not provided. Please provide one using the DATABASE_URL environment variable.`)
  process.exit(1)
}

const electric = process.env.ELECTRIC_IMAGE ?? "electricsql/electric:latest"

// 5433 is the logical publisher port
// it is exposed because PG must be able to connect to Electric
const res = shell.exec(
  `docker run \
      -e "DATABASE_URL=${db}" \
      -e "LOGICAL_PUBLISHER_HOST=localhost" \
      -e "AUTH_MODE=insecure" \
      -p ${electricPort}:5133 \
      -p ${electricProxyPort}:65432 \
      -p 5433:5433 ${electric}`
)

if (res.code !== 0 && res.stderr.includes('port is already allocated')) {
  // inform the user that they should change ports
  console.error(
    '\x1b[31m',
    'Could not start Electric because the port seems to be taken.\n' +
    'To run Electric on another port execute `yarn ports:configure`',
    '\x1b[0m'
  )
}

function error(err) {
  console.error('\x1b[31m', err + '\nyarn electric:start [-db <Postgres connection url>] [--electric-port <port>] [--electric-proxy-port <port>]', '\x1b[0m')
  process.exit(1)
}
