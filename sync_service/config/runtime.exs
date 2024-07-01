import Config

if Config.config_env() == :test do
  config :electric,
    database_config:
      PostgresqlUri.parse("postgresql://postgres:password@localhost:54321/postgres")
else
  config :electric, database_config: PostgresqlUri.parse(System.fetch_env!("DATABASE_URL"))
end
