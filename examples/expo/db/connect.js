const { DATABASE_URL } = require('./util.js')
const { spawn } = require('child_process')
spawn(`docker compose --file ../backend/compose/docker-compose.yaml exec  -it postgres psql -h localhost -U postgres`, [], { cwd: __dirname, stdio: 'inherit', shell: true })