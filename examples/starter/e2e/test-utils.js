import { spawn } from 'child_process'
import * as fs from 'fs/promises'

export function runCommand(command, cwd, inputArgs = [], outputListener) {
  const inputs = [...inputArgs]
  return new Promise((res, rej) => {
    const proc = spawn(command, [], {
      cwd,
      shell: true,
    })

    let errors = []
    proc.stderr.on('data', (data) => {
      errors = errors.concat(data)
    })

    // some dumb logic to simulate inputs
    let timer = null
    proc.stdin.setEncoding('utf-8')
    proc.stdout.on('data', (data) => {
      if (outputListener) {
        outputListener(Buffer.from(data).toString())
      }
      if (inputs.length > 0) {
        if (timer === null) {
          console.log('Received:', Buffer.from(data).toString())
        }

        // give a bit of time for stdout to finish
        clearTimeout(timer)
        timer = setTimeout(() => {
          const nextInput = inputs.shift()
          console.log('Responding with:', nextInput)
          timer = null
          proc.stdin.write(nextInput)
          proc.stdin.write('\n')
        }, 10)
      } else {
        proc.stdin.end()
      }
    })

    proc.on('close', (code) => {
      if (code === 0) {
        res()
      } else {
        const errStr = Buffer.concat(errors).toString()
        rej(errStr)
      }
    })
  })
}

export function assertFileExists(filePath) {
  return fs
    .stat(filePath)
    .then((f) => {
      if (!f.isFile()) {
        throw new Error(`File ${filePath} is not a file`)
      }
    })
    .catch(() => {
      throw new Error(`File ${filePath} does not exist`)
    })
}

export function assertDirectoryExists(dirPath) {
  return fs
    .stat(dirPath)
    .then((f) => {
      if (!f.isDirectory()) {
        throw new Error(`File ${dirPath} is not a directory`)
      }
    })
    .catch(() => {
      throw new Error(`File ${dirPath} does not exist`)
    })
}

export function readJsonFile(filePath) {
  return fs
    .readFile(filePath)
    .then((f) => JSON.parse(f.toString()))
    .catch(() => {
      throw new Error(`File ${filePath} does not exist`)
    })
}

/**
 * Asserts that a file contains a specific expression.
 *
 * @param {string} filePath - The path to the file.
 * @param {RegExp} searchExpression - The regular expression to search for in the file.
 * @throws {Error} If the file does not exist or does not contain the expression.
 */
export function assertFileContains(filePath, searchExpression) {
  return fs
    .readFile(filePath, 'utf-8')
    .catch(() => {
      throw new Error(`File ${filePath} does not exist`)
    })
    .then((f) => {
      if (!searchExpression.test(f)) {
        throw new Error(`File ${filePath} does not contain expression`)
      }
    })
}
