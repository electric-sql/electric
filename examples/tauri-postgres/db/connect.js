import { DATABASE_URL } from './util.js'
import { spawn } from 'child_process'
import * as url from 'url'

// The __dirname variable is not available in ES modules.
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

spawn(`psql ${DATABASE_URL}`, [], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
})
