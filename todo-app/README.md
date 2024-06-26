# vite-react-router-electric-sql-starter

A starter for building [local-first apps](https://bricolage.io/some-notes-on-local-first-development/) with [ElectricSQL](https://electric-sql.com/)

Built with:
- [Vite](https://vitejs.dev/)
- [React Router](https://reactrouter.com/en/main)
- [Electric Query](https://github.com/KyleAMathews/electric-query)

### Demo
https://github.com/KyleAMathews/vite-react-router-electric-sql-starter/assets/71047/f91196c1-a04c-4e36-8477-e9d1ae977d8c

## Install
- `npx git-scaffold@latest KyleAMathews/vite-react-router-electric-sql-starter#main new-electric-app`

## Usage

The starter includes some sample tables & code. You can either leave it to play with a simple example app or remove it to start from scratch.

To clean up the example code, run `npm run cleanup-example-code` and then make the following edits:
- `src/main.tsx` to remove the example route components

You're now ready to start adding tables and routes.

### Setup instructions
You need Docker/Docker Compose installed.

Edit `src/backend/compose/.envrc` and change the APP_NAME

To run Postgres/ElectricSQL:

`npm run backend:start`

Then run migrations to create your tables:

`npm run db:migrate`

Then create the client for running queries in the browser:

`npm run client:generate`

Finally start the dev server (it starts concurrently both vite for serving to the browser as well as the backend server).

`npm run dev`

## FAQs

Q) How do I change my schema?  
A) During early development it's often easiest to blow away the schema entirely — you can run `npm run backend:down` to remove the db/electric containers/volumes and then restart and re-run migrations. Once you have a production version of the application, you'll need to run schema migrations. To get the app to load, you'll also need to clear the browser schema as well by opening the devtools and deleting all stored data (in Chrome it's under the "Application" tab and the "Clear site data" button).

### TODOs
- [ ] Document auth
- [ ] Document how to host

Contributions welome!
