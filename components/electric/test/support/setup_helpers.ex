defmodule ElectricTest.SetupHelpers do
  @moduledoc """
  Different useful functions and setup helper
  """
  use Electric.Satellite.Protobuf
  import ExUnit.Callbacks

  @doc """
  Starts SchemaCache process with a given origin, and
  immediately fills it from given SQL.
  """
  def start_schema_cache(origin \\ "fake_origin", migrations) do
    backend = Electric.Postgres.MockSchemaLoader.start_link(migrations: migrations)

    start_supervised!(
      {Electric.Postgres.Extension.SchemaCache, {[origin: origin], [backend: backend]}}
    )

    [origin: origin]
  end
end
