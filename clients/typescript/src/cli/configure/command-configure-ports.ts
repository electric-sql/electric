import { Command } from 'commander'
import { getConfig } from '../config'
import fs from 'fs'
import portUsed from 'tcp-port-used'
import prompts from 'prompts'

export function makeConfigurePortsCommand() {
  const command = new Command('configure-ports')
  command
    .description('Configure the ports used by the ElectricSQL sync service')

    .action(async () => {
      configurePorts()
    })

  return command
}

export async function configurePorts() {
  const config = getConfig()
  const oldElectricPort = config.HTTP_PORT
  const oldElectricProxyPort = config.PG_PROXY_PORT

  console.log('Configuring ports for ElectricSQL sync service')

  const response = await prompts([
    {
      type: 'number',
      name: 'port',
      message:
        'Choose a port for Electric.\nPort should be between 0 and 65535.',
      initial: oldElectricPort,
      validate: validatePort,
    },
    {
      type: 'number',
      name: 'proxyPort',
      message:
        'Choose a port for the Electric DB Proxy.\nPort should be between 0 and 65535.',
      initial: oldElectricProxyPort,
      validate: validatePort,
    },
  ])

  console.log('Writing new configuration to .env.local')
  writeEnvLocal(response.port, response.proxyPort)
}

async function validatePort(port: number | '') {
  if (port === '') {
    // Keep the old port
    return true
  }
  if (port < 0 || port > 65535) {
    return 'Port must be between 0 and 65535'
  } else if (await portUsed.check(port)) {
    return 'Port is already in use'
  }
  return true
}

function writeEnvLocal(port: number, proxyPort: number) {
  const lines = fs.existsSync('.env.local')
    ? fs.readFileSync('.env.local', 'utf-8').split('\n')
    : []
  const serviceUrl = `http://localhost:${port}`
  const newLines = lines.map((line) => {
    if (line.startsWith('ELECTRIC_HTTP_PORT=')) {
      return `ELECTRIC_HTTP_PORT=${port}`
    } else if (line.startsWith('ELECTRIC_PG_PROXY_PORT=')) {
      return `ELECTRIC_PG_PROXY_PORT=${proxyPort}`
    } else if (line.startsWith('ELECTRIC_SERVICE=')) {
      return `ELECTRIC_SERVICE=${serviceUrl}`
    } else {
      return line
    }
  })
  if (!newLines.find((line) => line.startsWith('ELECTRIC_HTTP_PORT='))) {
    newLines.push(`ELECTRIC_HTTP_PORT=${port}`)
  }
  if (!newLines.find((line) => line.startsWith('ELECTRIC_PG_PROXY_PORT='))) {
    newLines.push(`ELECTRIC_PG_PROXY_PORT=${proxyPort}`)
  }
  if (!newLines.find((line) => line.startsWith('ELECTRIC_SERVICE='))) {
    newLines.push(`ELECTRIC_SERVICE=${serviceUrl}`)
  }
  fs.writeFileSync('.env.local', newLines.join('\n'))
}
