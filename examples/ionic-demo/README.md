<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

# Electric Appointments: An ElectricSQL & Ionic Example

This is an example showing how to build an Ionic Framework app using ElectricSQL, including packaging if for iOS and Android using Capacitor.

The app is a simple appointment scheduling app, the type a company would use to schedule appointments with clients. It's split into two workflows, one for the customer to schedule an appointment, and one for an employee to view and administer their calendar.

When built for the web it uses the wa-sqlite driver, for iOS and android it uses the capacitor-sqlite driver.

## Prereqs

You need Docker, Docker Compose v2 and Nodejs >= 16.14.

For building the Capacitor iOS and Android targets you need to follow the environment setup instructions here: https://capacitorjs.com/docs/getting-started/environment-setup

## Install

Clone this repo and change directory into this folder:

```sh
git clone https://github.com/electric-sql/electric
cd electric/examples/ionic-demo
```

Install the dependencies:

```shell
npm install
```

## Backend

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
npm run backend:up
# Or `npm run backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
npm run db:psql
```

The [database schema](https://electric-sql.com/docs/usage/data-modelling) for this example is in `db/migrations/create_tables.sql`.
You can apply it with:

```shell
npm run db:migrate
```

## Client

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
npm run client:generate
# or `npm run client:watch`` to re-generate whenever the DB schema changes
```

## Run the webapp

The app is a React application, to run it:

```bash
npm run start
// or this if you have the ionic cli installed:
ionic serve
```

The app displays the port on localhost where you can view the app.

## Build and run the iOS app

To build and run the app on an iOS device follow the prerequisites above and run:

```
ionic capacitor build ios
```

Xcode should open ready for running in the simulator or on a tethered device.

When testing in the iOS simulator, the device can see the Electric sync service on your `localhost`, however when running on another device you will need to build with an accessible `ELECTRIC_URL`. Note that as the app connects to the sync service with a web socket, when running on a different host you may have to use SSL (wss://). The easiest way to do this is with a service such as [ngrok](http://ngrok.com). For example:

```
ngrok http 5133
```

Then in another terminal with the url provided by ngrok

```
ELECTRIC_URL=https://abcdef123456.ngrok.app ionic capacitor build ios
```

## Build and run the Android app

To build and run the app on an iOS device follow the prerequisites above and run the following command, note you may have to expose your sync service on a an SSL enabled endpoint (see iOS instruction for an example with ngrok).

```
ELECTRIC_URL=https://hostname.of.sync.service ionic capacitor build android
```
