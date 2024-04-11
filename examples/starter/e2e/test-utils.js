import { spawn } from 'child_process'
import * as fs from 'fs/promises'

export function runCommand(command, cwd) {
  return new Promise((res, rej) => {
    const proc = spawn(command, [], {
      cwd,
      shell: true,
    })

    let errors = []
    proc.stderr.on('data', (data) => {
      errors = errors.concat(data)
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

