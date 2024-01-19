Apps running on DigitalOcean's App Platform can only accept HTTP/HTTPS connections. In order to connect to the [Migrations proxy](/docs/usage/data-modelling/migrations#migrations-proxy) that runs inside Electric, we need to start a local server that will tunnel TCP traffic over HTTP between a local Postgres client and Electric.

Open `examples/web-wa-sqlite/.env`, replace the URL on the `ELECTRIC_SERVICE=http://localhost:5133` line with your app's URL and add the `ELECTRIC_PROXY` configuration option below it:

```
ELECTRIC_SERVICE=https://electric-sync-service-4ha5b.ondigitalocean.app/
ELECTRIC_PROXY=postgresql://postgres:<proxy password>@localhost:65432
```

*(substitute the same password you configured for your DigitalOcean app's* `PG_PROXY_PASSWORD` *variable for the* `<proxy password>` *placeholder in the above URL)*

Make sure you have installed all of the dependencies for the example app by running `npm install` once. Now start the tunnel and keep it running while you go through the steps that follow:

```shell
$ npx electric-sql proxy-tunnel
ElectricSQL Postgres Proxy Tunnel listening on port 65432
Connected to ElectricSQL Service at https://electric-sync-service-4ha5b.ondigitalocean.app/
Connect to the database using:
  psql -h localhost -p 65432 -U <username> <database>
Or with the connection string:
  psql "postgres://<username>:<password>@localhost:65432/<database>"
Press Ctrl+C to exit
--
```
