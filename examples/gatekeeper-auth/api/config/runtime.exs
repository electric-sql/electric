import Config

if System.get_env("PHX_SERVER") do
  config :api, ApiWeb.Endpoint, server: true
end

if config_env() == :prod do
  auth_secret =
    System.get_env("AUTH_SECRET") ||
      raise """
      environment variable AUTH_SECRET is missing.
      It should be a long random string.
      """

  electric_url =
    System.get_env("ELECTRIC_URL") ||
      raise """
      environment variable ELECTRIC_URL is missing.
      For example: https://my-electric.example.com
      """

  # Configure the proxy endpoint to route shape requests to the external
  # Electric sync service.
  config :api,
    auth_secret: auth_secret,
    electric_url: electric_url

  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :api, Api.Repo,
    # ssl: true,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    socket_options: maybe_ipv6

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"
  port = System.get_env("PHX_PORT") || 443
  scheme = System.get_env("PHX_SCHEME") || "https"

  config :api, ApiWeb.Endpoint,
    url: [host: host, port: port, scheme: scheme],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://hexdocs.pm/bandit/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0},
      port: port
    ],
    secret_key_base: secret_key_base

  # Configure the URL that the Electric.Phoenix.Gateway.Plug uses when returning
  # shape config to the client. Defaults to this API, specifically the `/proxy`
  # endpoint configured in `../lib/api_web/router.ex`.
  default_proxy_url = URI.parse("https://#{host}:#{port}/proxy") |> URI.to_string()
  proxy_url = System.get_env("ELECTRIC_PROXY_URL") || default_proxy_url

  config :electric_phoenix, electric_url: proxy_url
end
