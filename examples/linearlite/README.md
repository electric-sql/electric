# linearlite

This is an example of an team collaboration app such as [linear](https://linear.app) built using electric-sql.

This example is built on top of the excellent clone of the the Linear UI built by 
Tuan Nguyen [@tuan3w](https://github.com/tuan3w) - The original is here 
[https://github.com/tuan3w/linearapp_clone](https://github.com/tuan3w/linearapp_clone). 
We have replaced the canned data with a local stack running electric in docker.


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

### Configure Postgres Database

This example uses [Prisma](https://www.prisma.io/) to manage Postgres schema. 
Prisma is a Node.js ORM for managing DB.

There are a set of Postgres migrations in `db/prisma/migrations`. 
To apply them to the local Postgres you will need to have node >=16.20.0 and yarn installed.

The dependency on `prisma-generator-electric` is being managed with yalc at the moment see [here](using_yalc.md)

run:

```bash
cd db
yalc add prisma-generator-electric
yarn
npx prisma migrate dev
```

This will both, reset the Postgres and push all the migrations to it, and regenerate the typescript client code matching
the schema to be used by the `elecrtic-sql` client, it writes it into `../client/web/src/generated/models`

### Run web app

The dependency on `electric-sql` is being managed with yalc at the moment see [here](using_yalc.md)

The app is a React application to install and run it:

```bash
cd client/web
nvm use v16.20.0
yalc add electric-sql
yarn
yarn build
yarn start
```
The app should be available on `localhost:4002`