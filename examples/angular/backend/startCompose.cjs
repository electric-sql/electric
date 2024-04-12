const { dockerCompose } = require('../util/util.cjs')
const process = require('process')

const cliArguments = process.argv.slice(2)

dockerCompose('up', cliArguments, (code) => {
  if (code !== 0) {
    console.error(
      '\x1b[31m',
      'Failed to start the Electric backend. Check the output from `docker compose` above.\n' +
      'If the error message mentions a port already being allocated or address being already in use,\n' +
      'execute `yarn ports:configure` to run Electric on another port.',
      '\x1b[0m'
    )
  }
})
