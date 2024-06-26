const shell = require(`shelljs`)

shell.rm(`db/migrations/001-create-contacts.sql`)
shell.rm(`db/migrations/002-create-favorite-contacts.sql`)
shell.rm(`src/daos/contacts.ts`)
shell.rm(`src/index.css`)
shell.touch(`src/index.css`)
shell.rm(`src/routes/*`)
