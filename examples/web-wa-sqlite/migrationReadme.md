# Frontend-based Migrations

We now describe how to turn a local application into an Electric application.
With local application we mean an application that uses a SQLite DB on the frontend but does not have a backend.

## Local SQLite DB

For this example, our local SQLite database will reside in the `db` folder.
Let's first create this database:
```sh
cd db
sh createDB.sh
```

The script above created a dummy database called `db/dev.db`.\
You probably already have your database from which to start.

## Turning our local app into an Electric app

Now, let's turn our local application into an Electric application.
To this end, we need to export the path to the SQLite DB (because it is used by the Prisma schema) and run the `frontEndMigrate.sh` script.
The path to our dummy database is `"file:../db/dev.db"` but this could be different for you.
```sh
export DATABASE_URL="file:../db/dev.db"
sh frontendMigrate.sh -p prisma/schema.prisma
```

The output should look like this:
```sh
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "dev.db" at "file:../db/dev.db"

✔ Introspected 1 model and wrote it into prisma/schema.prisma in 12ms
      
Run prisma generate to generate Prisma Client.

[+] Running 5/5
 ⠿ Network local-stack_default         Created                                                                                          0.0s
 ⠿ Container local-stack-postgres_1-1  Started                                                                                          0.6s
 ⠿ Container local-stack-vaxine_1-1    Started                                                                                          0.4s
 ⠿ Container local-stack-local_api-1   Started                                                                                          0.6s
 ⠿ Container local-stack-electric_1-1  Started                                                                                          0.8s
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100 15916  100 15916    0     0  71053      0 --:--:-- --:--:-- --:--:-- 70737
=> Downloading nvm as script to '/root/.nvm'

=> Appending nvm source string to /root/.bashrc
=> Appending bash_completion source string to /root/.bashrc
=> Close and reopen your terminal to start using nvm or run the following to use it now:

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
Downloading and installing node v20.3.0...
Downloading https://nodejs.org/dist/v20.3.0/node-v20.3.0-linux-arm64.tar.xz...
######################################################################## 100.0%
Computing checksum with sha256sum
Checksums matched!
Now using node v20.3.0 (npm v9.6.7)
Creating default alias: default -> node (-> v20.3.0 *)

added 2 packages in 8s
npm notice 
npm notice New minor version of npm available! 9.6.7 -> 9.7.1
npm notice Changelog: <https://github.com/npm/cli/releases/tag/v9.7.1>
npm notice Run `npm install -g npm@9.7.1` to update!
npm notice 
Prisma schema loaded from data/schema.prisma
Datasource "db": PostgreSQL database "electric", schema "public" at "localhost:5432"

The database is already in sync with the Prisma schema.

  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   688  100   688    0     0  88808      0 --:--:-- --:--:-- --:--:--  167k
rm: ./migrations/*: No such file or directory
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "electric-tmp.db" at "file:electric-tmp.db"

✔ Introspected 1 model and wrote it into prisma/schema.prisma in 10ms
      
Run prisma generate to generate Prisma Client.

Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (4.8.1 | library) to ./../../node_modules/.pnpm/@prisma+client@4.8.1_prisma@4.8.1/node_modules/@prisma/client in 32ms

✔ Generated Zod Prisma Types to ./src/generated/models in 16ms
You can now start using Prisma Client in your code. Reference: https://pris.ly/d/client

import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

Building migrations...
Successfully built migrations
```

A lot happened here!\
The script introspected our local SQLite DB to update the Prisma schema based on the schema of the local DB.
Then it launched the local stack and migrated Electric's Postgres DB which now has the same schema as the local DB.
You can verify this:

```sh
docker exec -it -e PGPASSWORD=password local-stack-postgres_1-1  psql -h 127.0.0.1 -U postgres -d electric
electric=# \dt
         List of relations
 Schema | Name  | Type  |  Owner   
--------+-------+-------+----------
 public | items | table | postgres
(1 row)
```

Afterwards, the script generated a new Electric typescript client in `src/generated/models`.
It also built the necessary triggers and wrote them together with the migrations to `.electric/items-example/local/index.mjs`.
Now, when you will start your Electric application, it will read the migrations from `.electric/items-example/local/index.mjs` and apply them on its local SQLite DB in the browser.
Note that the SQLite DB that runs in the browser is different from your original SQLite DB that is present on your filesystem.
Your original DB was only used to set up your Electric app but will not be used anymore.
Still, it can be useful to keep it if you later want to migrate your schema
(you can simply migrate the local DB and call `frontendMigrate.sh` again to migrate the backend).

Note that the script launched the local stack which is still running in the background.
You can kill it by running `docker-compose down` in the `../../local-stack` folder.
