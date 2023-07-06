# Paul's Notes

app built in top of [https://github.com/tuan3w/linearapp_clone](https://github.com/tuan3w/linearapp_clone)

## progress so far:

- Changed build system from craco to esbuild
- Replaced a bunch of plugins
- Stripped out canned data
- Added in electric - mostly in App.tsx and electric.tsx
- Home page loads list of issues
- You can create new Issues
- You can update an Issues status and priority
- Added Users and Comments to the Postgres
- Started fixing up the Board page
- Added a script with @Database/pg to apply SQL to Postgres using node rather than psql

The App did not have a model for connemts before so adding the UI for this is the biggest thing to do.
This could just be in the form of a single page for the Issue with an ordered list of comments below and the ability to 
add new comments.

## To do
- Issue Page
- Add Comments UI 
- Filtering and sorting of Issues
- Deleting issues
- Add some simple (device based?) User creation
- There is a kanban board page I started adding electric to this need finishing
- Mechanism to import dataset into Postgres

## Issues

- Loading a Postgres create table twice causes duplicate migrations from electric
- Loading and syncing between Chrome and Safari locally works but after  mins or so sync stops working
- The quickstart and examples should be similar to each other
- Should they share a top level whole repo pnpm install and build readme?
