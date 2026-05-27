# agents-runtime instructions

`agents-runtime` is tenant-unaware by design. Treat the configured `baseUrl` as
the base of the complete Electric Agents server API surface and append protocol
paths under it without interpreting tenanting, cloud routing, or service
identity.

Server implementations may add tenants, auth, proxies, or path-prefix stripping
outside this package. Runtime code must not parse tenant/service query
parameters, construct tenant path prefixes, or special-case hosted Electric
Cloud URLs. Authentication is likewise caller-provided: preserve and forward the
headers/options passed into runtime APIs rather than deriving cloud-specific
headers here.
