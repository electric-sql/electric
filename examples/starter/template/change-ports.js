const portUsed = require('tcp-port-used')
const prompt = require('prompt')
const path = require('path')
const fs = require('fs/promises')

// Regex to check that a number is between 0 and 65535
const portRegex = /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/

init()

// Wrap code in an anonymous async function
// such that we can await
async function init() {
  // Find the old ports for Electric and the webserver
  // such that we know which ports to replace
  const electricPortRegex = /http:\/\/localhost:([0-9]+)/
  const webserverPortRegex = /listen\(([0-9]+)\)/
  
  //const __dirname = path.dirname(fileURLToPath(import.meta.url)) // because __dirname is not defined when using modules
  const packageJsonFile = path.join(__dirname, 'package.json')
  const builderFile = path.join(__dirname, 'builder.js')
  
  const oldElectricPort = await findFirstMatchInFile(electricPortRegex, packageJsonFile, 'Could not find current Electric port in package.json')
  const oldWebserverPort = await findFirstMatchInFile(webserverPortRegex, builderFile, 'Could not find current webserver port in builder.js')

  prompt.start()
  let electricPort = oldElectricPort
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
  webserverPort = await checkPort(userInput.webserverPort, 'the web server', 3001)
  
  // Update port in package.json file
  const packageJsonContents = await fs.readFile(packageJsonFile, 'utf8')
  await findAndReplaceInFile(`http://localhost:${oldElectricPort}`, `http://localhost:${electricPort}`, packageJsonFile)
  
  // Update the port on which Electric runs in the builder.js file
  await findAndReplaceInFile(oldElectricPort, `${electricPort}`, builderFile)
  
  // Update the port on which Electric runs in startElectric.js file
  const startElectricFile = path.join(__dirname, 'backend', 'startElectric.js')
  await findAndReplaceInFile(oldElectricPort, `${electricPort}`, startElectricFile)
  
  // Update the port of the web server of the example in the builder.js file
  await findAndReplaceInFile(new RegExp(`/${oldWebserverPort}/g`), `${webserverPort}`, builderFile)
  
  // Update the port for Electric in .envrc
  const envrcFile = path.join(__dirname, 'backend', 'compose', '.envrc')
  await findAndReplaceInFile(`export ELECTRIC_PORT=${oldElectricPort}`, `export ELECTRIC_PORT=${electricPort}`, envrcFile)
  
  console.info(`⚡️ Success! Your project is now configured to run Electric on port ${electricPort} and the webserver on port ${webserverPort}.`)
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

async function findFirstMatchInFile(regex, file, notFoundError) {
  const content = await fs.readFile(file, 'utf8')
  const res = content.match(regex)
  if (res === null) {
    console.error(notFoundError)
    process.exit(1)
  }
  return res[1]
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
  
  spinner.stop()
  
  // Warn the user that the chosen port is occupied
  console.warn(`Port ${port} for ${process} already in use.`)
  // Propose user to change port
  prompt.start()
  const i = (await prompt.get({
    properties: {
      switch: {
        description: `Do you want to chose another port for ${process}? [y/n]`,
        type: 'string',
        pattern: /^[y|n]$/,
        message: "Please reply with 'y' or 'n'",
        default: 'y',
      }
    }
  }))
  
  if (i.switch === 'y') {
    const { port } = (await prompt.get({
      properties: {
        port: {
          description: 'port',
          type: 'number',
          pattern: portRegex,
          message: 'Please choose a port between 0 and 65535',
          default: defaultPort,
        }
      }
    }))
    return checkPort(port, process, defaultPort)
  }
  else {
    return port
  }
}