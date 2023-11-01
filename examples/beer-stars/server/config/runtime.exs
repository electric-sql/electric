import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/stars start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if System.get_env("PHX_SERVER") do
  config :beer_stars, BeerStarsWeb.Endpoint, server: true
end

# Configure the token auth
github_tokens =
  System.get_env("GITHUB_TOKENS") ||
    raise """
    environment variable GITHUB_TOKENS is missing.

    You must provide a space seperated list of access tokens.
    For example: "ghp_abcd ghp_efgh"

    Note that as setup atm, these need to be classic personal
    access tokens (not fine grained) and that the organisation
    with the repo needs to enable support for them.
    """

start_worker = System.get_env("BEER_STARS_WORKER") === "true"
target_repo = System.get_env("GITHUB_REPO", "electric-sql/electric")

config :beer_stars,
  github_tokens: github_tokens,
  github_repo: target_repo,
  worker: start_worker

if(config_env() == :prod) do
  database_host =
    System.get_env("DATABASE_HOST") ||
      raise """
      environment variable DATABASE_HOST is missing.
      We need both host and URL to make the SSL work.
      """

  ssl_var = String.downcase("#{System.get_env("DATABASE_SSL")}")
  database_ssl = ssl_var == "true" || ssl_var == "yes"

  database_url =
    System.get_env("DATABASE_URL") ||
      raise """
      environment variable DATABASE_URL is missing.
      For example: ecto://USER:PASS@HOST/DATABASE
      """

  proxy_url =
    System.get_env("PROXY_URL") ||
      raise """
      environment variable PROXY_URL is missing.
      For example: ecto://postgres:PASS@HOST:65432/DATABASE
      """

  maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  config :beer_stars, BeerStars.Repo,
    ssl: database_ssl,
    ssl_opts: [
      server_name_indication: to_charlist(String.trim(database_host)),
      verify: :verify_none,
      versions: [:"tlsv1.2", :"tlsv1.3"]
    ],
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "5"),
    socket_options: maybe_ipv6

  # the repo we connect to in order to run migrations
  config :beer_stars, BeerStars.ProxyRepo,
    # ssl support for the proxy will be supported eventually
    ssl: false,
    # ecto requires at least 2 connections for the migrations
    # but that's it
    pool_size: 2,
    url: proxy_url,
    priv: "priv/repo"

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"
  port = String.to_integer(System.get_env("PORT") || "4000")
  scheme = System.get_env("PHX_SCHEME") || "http"

  config :beer_stars, BeerStarsWeb.Endpoint,
    url: [host: host, port: port, scheme: scheme],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://hexdocs.pm/plug_cowboy/Plug.Cowboy.html
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0},
      port: port
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :beer_stars, BeerStarsWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://hexdocs.pm/plug/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your endpoint, ensuring
  # no data is ever sent via http, always redirecting to https:
  #
  #     config :beer_stars, BeerStarsWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.
end
