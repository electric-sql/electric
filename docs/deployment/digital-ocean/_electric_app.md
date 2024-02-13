Apps running on DigitalOcean's App Platform can only accept HTTP/HTTPS connections. In order to connect to the [Migrations proxy](/docs/deployment/concepts#migrations-proxy) that runs inside Electric, we need to start a local server that will tunnel TCP traffic between a local Postgres client and Electric running on DigitalOcean over the HTTP protocol.

Create a file named `.env.local` inside your client app's root directory with the following contents:

```shell
ELECTRIC_SERVICE=https://electric-sync-service-4ha5b.ondigitalocean.app/
ELECTRIC_PG_PROXY_HOST=localhost

# This should be the same password as the one used
# for PG_PROXY_PASSWORD in your app config
ELECTRIC_PG_PROXY_PASSWORD=proxy_password
```

Make sure you have installed all of the dependencies for the client app by running `npm install` once. Start the [proxy tunnel](/docs/deployment/concepts#22-using-a-proxy-tunnel) and keep it running while you go through the steps that follow:

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
