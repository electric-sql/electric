# linearlite

This is an example of an team collaboration app such as [linear](https://linear.app) built using electric-sql.

This example is built on top of the excellent clone of the the Linear UI built by 
Tuan Nguyen [@tuan3w](https://github.com/tuan3w) - The original is here 
[https://github.com/tuan3w/linearapp_clone](https://github.com/tuan3w/linearapp_clone). 
We have replaced the canned data with a local stack running electric in docker.


## Run example

### Start a local electrified Postgres

Run the electric local-stack which is in `/local-stack`

```bash
cd ../../local-stack
source .envrc
docker-compose up
```
This will start a local Postgres and the Electric service on your machine.

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
npx prisma migrate
```

### Run web app

The dependency on `electric-sql` is being managed with yalc at the moment see [here](using_yalc.md)

The app is a React application to install and run it:

```bash
cd client/web
yalc add electric-sql
yarn build
yarn start
```
The app should be available on `localhost:4002`