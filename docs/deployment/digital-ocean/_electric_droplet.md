A Droplet is just a virtual server that may have any number of ports open. This allows us to connect to the Electric proxy directly without having to run a local tunnel:

```shell
$ psql postgresql://postgres:******@167.99.132.206:65432
psql (15.4, server 15.1 (Ubuntu 15.1-1.pgdg20.04+1))
Type "help" for help.

[167] postgres:postgres=>
```

Create a file named `.env.local` inside your client app's root directory and use your Droplet's IP address to add the `ELECTRIC_SERVICE` configuration option to it:

```shell
ELECTRIC_SERVICE=http://167.99.132.206
```
