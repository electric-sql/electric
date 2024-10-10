import Config

config :logger, level: :warning

if config_env() == :test do
  default_database_url = "postgresql://postgres:password@localhost:54321/electric"
  database_url = System.get_env("DATABASE_URL", default_database_url)

  default_electric_url = "http://localhost:3000"
  electric_url = System.get_env("ELECTRIC_URL", default_electric_url)

  config :electric_client,
    database_config: PostgresqlUri.parse(database_url),
    electric_url: electric_url

  config :electric_client, Support.Repo, url: database_url
end
