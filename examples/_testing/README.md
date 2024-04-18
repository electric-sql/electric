
# ElectricSQL Example Tests

This project contains shared code for testing the ElectricSQL example apps.

Most examples test integrations with different SQLite drivers or view frameworks, but all of them are ultimately the same canonical applicaton for adding and removing items.

## Pre-reqs

- Docker (with Compose V2)
- Node >= 18.0.0

## Usage

### Web Examples

For web projects we use [Playwright](https://playwright.dev/) to run the end-to-end tests.

First run the example application you want to test, e.g.:
```sh
cd ../web-wa-sqlite # or any other web example

# install project dependencies
npm install

# start the backend, migrate, and generate client
npm run backend:up
npm run db:migrate
npm run client:generate

# start dev server in the background
npm run dev < /dev/null &
```

Then run the end-to-end tests:
```sh
pnpm web-e2e
```

This should install the requried browser binaries and spin them up in headless mode to run the tests.

You can configure what browsers to test and other specifics in the `playwright.config.ts` configuration file. Check out the [documentation](https://playwright.dev/docs/test-configuration) for more details.

Note that we set the tests to run serially for each browser by setting `workers` to 1 as the test will use a shared Electric instance that will sync items between the browsers and fail the tests.
