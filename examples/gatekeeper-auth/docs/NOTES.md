### Seperating the concerns

With the [proxy auth pattern](https://electric-sql.com/docs/guides/auth#proxy), the proxy performs authorisation logic on the shape request path. Performing this logic can be expensive. You may not want to query the database or call an external service every time you make a shape request [1]. It can also be a security concern. Do you want your database exposed to your edge worker?

The gatekeeper pattern avoids these concerns by separating the steps of:

1. running authorisation logic to determine whether a user should be able to access a shape
2. authorising a shape request to Electric

Specifically, the gatekeeper endpoint is designed to perform authorisation logic *once* when generating the shape-scoped token. The proxy endpoint can then authorise multiple shape requests by validating the token against the shape definition in the request, without needing to know or do anything else.

[1] Proxies can mitigate this in a number of ways, for example with some kind of local cache of client credentials against authorisation state.
