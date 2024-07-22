defmodule Electric.Replication.Eval.Env.BasicTypes do
  @moduledoc """
  This module describes basic types, their categories, and if they are preferred within said category.
  Information here is gathered from a system catalog `pg_type`, as described in
  [PG docs](https://www.postgresql.org/docs/current/catalog-pg-type.html).

  ## Known types

  | type                    | category | preferred? |
  | ----------------------- | -------- | ---------- |
  | bool                    | boolean  | t          |
  | int2                    | numeric  |            |
  | int4                    | numeric  |            |
  | int8                    | numeric  |            |
  | float4                  | numeric  |            |
  | float8                  | numeric  | t          |
  | numeric                 | numeric  |            |
  | name                    | string   |            |
  | text                    | string   | t          |
  | varchar                 | string   |            |
  | date                    | datetime |            |
  | time                    | datetime |            |
  | timestamp               | datetime |            |
  | timestamptz             | datetime | t          |
  | unknown                 | unknown  |            |
  | bytea                   | user     |            |
  | uuid                    | user     |            |
  | anyarray                | pseudo   |            |
  | anycompatible           | pseudo   |            |
  | anycompatiblearray      | pseudo   |            |
  | anycompatiblemultirange | pseudo   |            |
  | anycompatiblenonarray   | pseudo   |            |
  | anycompatiblerange      | pseudo   |            |
  | anyelement              | pseudo   |            |
  | anyenum                 | pseudo   |            |
  | anymultirange           | pseudo   |            |
  | anynonarray             | pseudo   |            |
  | anyrange                | pseudo   |            |
  """

  @known_types @moduledoc
               |> Electric.Utils.parse_md_table(after: "## Known types")
               |> Map.new(fn [type, category, preferred] ->
                 {String.to_atom(type),
                  %{category: String.to_atom(category), preferred?: preferred == "t"}}
               end)

  @doc """
  List all known basic types

  ## Examples

      iex> noop(known()[:timestamptz])
      %{category: :datetime, preferred?: true}
  """
  def known(), do: @known_types

  def noop(input), do: input
end
