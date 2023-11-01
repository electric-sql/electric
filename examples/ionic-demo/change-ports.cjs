const portUsed = require('tcp-port-used')
const prompt = require('prompt')
const path = require('path')
const fs = require('fs/promises')
const { findFirstMatchInFile, fetchConfiguredElectricPort, fetchConfiguredElectricProxyPort } = require('./util/util.cjs')

// Regex to check that a number is between 0 and 65535
const portRegex = /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/

init()

// Wrap code in an anonymous async function
// such that we can await
async function init() {
  // Find the old ports for Electric, its proxy, and the webserver
  // such that we know which ports to replace
  const webserverPortRegex = /listen\(([0-9]+)\)/
  
  const packageJsonFile = path.join(__dirname, 'package.json')
  const builderFile = path.join(__dirname, 'builder.js')
  
  const oldElectricPort = await fetchConfiguredElectricPort()
  const oldElectricProxyPort = await fetchConfiguredElectricProxyPort()
  const oldWebserverPort = await findFirstMatchInFile(webserverPortRegex, builderFile, 'Could not find current webserver port in builder.js')

  prompt.start()
  let electricPort = oldElectricPort
  let electricProxyPort = oldElectricProxyPort
  let webserverPort = oldWebserverPort
  
  const userInput = await prompt.get({
    properties: {
      electricPort: {
        description: 'Choose a port for Electric',
        type: 'number',
        pattern: portRegex,
        message: 'Port should be between 0 and 65535.',
        default: oldElectricPort
      },
      electricProxyPort: {
        description: "Choose a port for Electric's DB proxy",
        type: 'number',
        pattern: portRegex,
        message: 'Port should be between 0 and 65535.',
        default: electricProxyPort
      },
      webserverPort: {
        description: 'Choose a port the webserver',
        type: 'number',
        pattern: portRegex,
        message: 'Port should be between 0 and 65535.',
        default: oldWebserverPort
      },
    }
  })
  
  electricPort = await checkPort(userInput.electricPort, 'Electric', 5133)
  electricProxyPort = await checkPort(userInput.electricProxyPort, "Electric's proxy", 65432)
  webserverPort = await checkPort(userInput.webserverPort, 'the web server', 3001)
  
  // Update port in package.json file
  await findAndReplaceInFile(`http://localhost:${oldElectricPort}`, `http://localhost:${electricPort}`, packageJsonFile)
  await findAndReplaceInFile(
    `postgresql://prisma:password@localhost:${oldElectricProxyPort}/electric`,
    `postgresql://prisma:password@localhost:${electricProxyPort}/electric`, packageJsonFile
  )
  
  // Update the port on which Electric runs in the builder.js file
  await findAndReplaceInFile(`ws://localhost:${oldElectricPort}`, `ws://localhost:${electricPort}`, builderFile)
  
  // Update the port on which Electric and its proxy run in startElectric.js file
  const startElectricFile = path.join(__dirname, 'backend', 'startElectric.js')
  await findAndReplaceInFile(oldElectricPort, `${electricPort}`, startElectricFile)
  await findAndReplaceInFile(oldElectricProxyPort, `${electricProxyPort}`, startElectricFile)
  
  // Update the port of the web server of the example in the builder.js file
  await findAndReplaceInFile(`listen(${oldWebserverPort})`, `listen(${webserverPort})`, builderFile)
  await findAndReplaceInFile(`http://localhost:${oldWebserverPort}`, `http://localhost:${webserverPort}`, builderFile)
  
  // Update the port for Electric and its proxy in .envrc
  const envrcFile = path.join(__dirname, 'backend', 'compose', '.envrc')
  await findAndReplaceInFile(`export ELECTRIC_PORT=${oldElectricPort}`, `export ELECTRIC_PORT=${electricPort}`, envrcFile)
  await findAndReplaceInFile(`export ELECTRIC_PROXY_PORT=${oldElectricProxyPort}`, `export ELECTRIC_PROXY_PORT=${electricProxyPort}`, envrcFile)
  
  console.info(`⚡️ Success! Your project is now configured to run Electric on port ${electricPort}, the DB proxy on port ${electricProxyPort}, and the webserver on port ${webserverPort}.`)
}

/*
* Replaces the first occurence of `find` by `replace` in the file `file`.
* If `find` is a regular expression that sets the `g` flag, then it replaces all occurences.
*/ 
async function findAndReplaceInFile(find, replace, file) {
  const content = await fs.readFile(file, 'utf8')
  const replacedContent = content.replace(find, replace)
  await fs.writeFile(file, replacedContent)
}

/**
 * Checks if the given port is open.
 * If not, it will ask the user if
 * they want to choose another port.
 * @returns The chosen port.
 */
async function checkPort(port, process, defaultPort) {
  const portOccupied = await portUsed.check(port)
  if (!portOccupied) {
    return port
  }
  
  // Warn the user that the chosen port is occupied
  console.warn(`Port ${port} for ${process} is already in use.`)
  // Propose user to change port
  prompt.start()
  
  const { port: newPort } = (await prompt.get({
    properties: {
      port: {
        description: 'Hit Enter to keep it or enter a different port number',
        type: 'number',
        pattern: portRegex,
        message: 'Please choose a port between 0 and 65535',
        default: port,
      }
    }
  }))

  if (newPort === port) {
    // user chose not to change port
    return newPort
  }
  else {
    // user changed port, check that it is free
    return checkPort(newPort, process, defaultPort)
  }
}