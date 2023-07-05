defmodule ElectricTest.SetupHelpers do
  @moduledoc """
  Different useful functions and setup helper
  """
  import ExUnit.Callbacks
  import ExUnit.Assertions

  @doc """
  Starts SchemaCache process with a given origin, and
  immediately fills it from given SQL.
  """
  def start_schema_cache(origin \\ "fake_origin", sql) do
    start_supervised!(
      {Electric.Postgres.Extension.SchemaCache,
       {[origin: origin], [backend: {Electric.Postgres.MockSchemaLoader, parent: self()}]}}
    )

    schema =
      Electric.Postgres.Schema.new()
      |> Electric.Postgres.Schema.update(sql,
        oid_loader: fn type, schema, name ->
          {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
        end
      )

    assert {:ok, _} =
             Electric.Postgres.Extension.SchemaCache.save(
               origin,
               "20230101",
               schema,
               sql
             )

    [origin: origin]
  end
end
