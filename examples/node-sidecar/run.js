#!/usr/bin/node

const { spawn } = require('child_process')
const path = require('path')

let lastProc = null
function exec(cmd, args, path, stdin = 'ignore') {
  const proc = spawn(cmd, args, {
    stdio: [stdin, 'inherit', 'inherit'],
    shell: process.platform == 'win32',
    cwd: path
  })

  lastProc = proc

  return new Promise((resolve, reject) => { 
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command "${cmd} ${args.join(' ')}" exited with non-zero exit code ${code}`))
      }
      else {
        resolve()
      }
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const appPath = path.join(__dirname, 'apps', 'node')

const main = async () => {
  const sidecarPath = path.join(__dirname, 'sidecar')
  // start the sidecar in a child process
  // don't await it otherwise we will be blocked here
  exec('yarn', ['start', 'config.json'], sidecarPath).catch(() => {
    // this one may throw because we kill it later when the app is done
  })
  const sidecarProcess = lastProc
  
  // give the sidecar some time to start and sync the shapes
  await sleep(2000)
  
  // start the app
  await exec('yarn', ['start', 'config.json'], appPath, 'inherit')
  
  // Stop the sidecar and the backend
  sidecarProcess.kill('SIGKILL')
}

main()