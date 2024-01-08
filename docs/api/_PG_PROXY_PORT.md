Port number for connections to the [Migrations proxy](../usage/data-modelling/migrations#migrations-proxy).

Electric provides a migrations proxy service over TCP that speaks the [Postgres protocol](https://www.postgresql.org/docs/current/protocol.html). This configures the port that this service is exposed on.

If you have Electric deployed behind a restrictive firewall that only allows HTTP/HTTPS connections, you can set the value to `http` or add `http:` as a prefix to the port number. This will enable tunelling mode in which the migrations proxy will accept WebSocket connections from the [Proxy tunnel](../cli#proxy-tunnel).

Setting the value to `http` disables the TCP service and only accepts connections via the tunnel. Prefixing with `http:` leaves the TCP service exposed.