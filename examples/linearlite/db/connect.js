import DATABASE_URL from './util.js'
import spawn from 'child_process'
spawn(`psql ${DATABASE_URL}`, [], {
  cwd: __dirname,
  stdio: 'inherit',
  shell: true,
})
