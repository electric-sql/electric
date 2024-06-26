const { DATABASE_URL } = require(`./util.cjs`)
const { spawn } = require(`child_process`)
spawn(`psql ${DATABASE_URL}`, [], {
  cwd: __dirname,
  stdio: `inherit`,
  shell: true,
})
