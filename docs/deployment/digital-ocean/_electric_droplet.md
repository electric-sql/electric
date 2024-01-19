A Droplet is just a virtual server that may have any number of ports open. This allows us to connect to the Electric proxy directly without having to run a local tunnel:

```shell
$ psql postgresql://postgres:******@167.99.132.206:65432
psql (15.4, server 15.1 (Ubuntu 15.1-1.pgdg20.04+1))
Type "help" for help.

[167] postgres:postgres=>
```

Open `examples/web-wa-sqlite/.env` and replace the URL on the `ELECTRIC_SERVICE=http://localhost:5133` line with your Droplet's IP address:

```
ELECTRIC_SERVICE=http://167.99.132.206
```

Make sure you have installed all of the dependencies for the example app by running `npm install` once. Now you should have everything ready to proceed with building the client app.
