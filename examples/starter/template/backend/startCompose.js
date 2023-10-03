const shell = require('shelljs')
const path = require('path')

const envrcFile = path.join(__dirname, 'compose', '.envrc')
const composeFile = path.join(__dirname, 'compose', 'docker-compose.yaml')

const cliArguments = process.argv.slice(2).join(' ')

const res = shell.exec(`docker compose --env-file ${envrcFile} -f ${composeFile} up ${cliArguments}`)

if (res.code !== 0 && res.stderr.includes('port is already allocated')) {
  // inform the user that they should change ports
  console.error(
    '\x1b[31m',
    'Could not start Electric because the port seems to be taken.\n' +
    'To run Electric on another port execute `yarn ports:configure`'
  )
}
