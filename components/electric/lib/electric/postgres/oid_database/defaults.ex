defmodule Electric.Postgres.OidDatabase.Defaults do
  import Electric.Postgres.OidDatabase.PgType

  @external_resource Path.expand("default_types.csv", __DIR__)
  @pg_oid_values Path.expand("default_types.csv", __DIR__)
                 |> File.read!()
                 |> String.split("\n", trim: true)
                 |> Enum.drop(1)
                 |> Enum.map(&String.split(&1, ",", trim: true))
                 |> Enum.map(&List.to_tuple/1)
                 |> Enum.map(&pg_type_from_tuple/1)

  def get_defaults(), do: @pg_oid_values
end
