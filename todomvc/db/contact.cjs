const { DATABASE_URL } = require(`./util.js`)
const { spawn } = require(`child_process`)
spawn(`psql ${DATABASE_URL}`, [], {
  cwd: __dirname,
  stdio: `inherit`,
  shell: true,
})
