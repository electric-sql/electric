# linearlite

This is an example of a team collaboration app such as [linear](https://linear.app) built using electric-sql.

This example is built on top of the excellent clone of the Linear UI built by 
Tuan Nguyen [@tuan3w](https://github.com/tuan3w) - The original is here 
[https://github.com/tuan3w/linearapp_clone](https://github.com/tuan3w/linearapp_clone). 
We have replaced the canned data with a local stack running electric in Docker.


## Run example

### Start a local electrified Postgres

Run the electric local-stack which is in `/local-stack`

see here https://electric-sql.com/docs/overview/examples

```bash
cd ../../local-stack
source .envrc
docker compose pull
docker compose up -d
```

This will start a local Postgres and the Electric service on your machine.

You can then talk to the Postgres with psql using the password `password`:

```psql -h 127.0.0.1 -U postgres -d electric ```

### Configure Node

This project is using Node v16.20.0 and pnpm to manage dependencies

```
nvm use v16.20.0
npm install -g pnpm
```

### Install 

In the root of the electric folder install all the js dependencies for submodules and examples:

```
pnpm install
```

Then build the electric code generator and the typescript client:

```
cd generator
pnpm build
cd ../clients/typescript
pnpm build
cd ../..
```

### Apply migrations to Postgres

This example uses [Prisma](https://www.prisma.io/) to manage the Postgres schema. 
Prisma is a Node.js ORM for managing DB.

There is an initial Postgres migration in `db/prisma/migrations`. 
To apply them to the local Postgres you will need to have node >=16.20.0 and yarn installed.

run:

```bash
cd db
npx prisma migrate dev
```

This will push all the migrations to the database.

### Electrify Postgres

log into Postgres with password `password`

```
psql -h 127.0.0.1 -U postgres -d electric 

```
then run 
```
CALL electric.electrify('issue');
```
This will tell electric to sync the table `issue`

### Run web app

The app is a React application to install and run it:

```bash
cd client
pnpm build
pnpm start
```
The app should be available on `localhost:8000`