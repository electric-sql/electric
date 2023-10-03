defmodule Electric.Replication.Eval.Env.ExplicitCasts do
  @moduledoc """
  Postgres has explicit casts, achievable via `::type` calls.
  This module defines implementations for a subset of known ones.
  "function name" column here is a function name in this module.

  ## List of explicit casts

  | source    | target         | function name |
  | --------- | -------------- | ------------- |
  | bool      | int4           | bool_to_int4  |
  | char      | int4           |               |
  | int8      | bit            |               |
  | int4      | bit            |               |
  | int4      | bool           | int4_to_bool  |
  | int4      | char           |               |
  | text      | xml            |               |
  | lseg      | point          |               |
  | box       | point          |               |
  | box       | lseg           |               |
  | box       | circle         |               |
  | polygon   | box            |               |
  | polygon   | circle         |               |
  | polygon   | point          |               |
  | circle    | box            |               |
  | circle    | point          |               |
  | circle    | polygon        |               |
  | bpchar    | xml            |               |
  | varchar   | xml            |               |
  | bit       | int4           |               |
  | bit       | int8           |               |
  | jsonb     | bool           |               |
  | jsonb     | int8           |               |
  | jsonb     | int2           |               |
  | jsonb     | int4           |               |
  | jsonb     | float4         |               |
  | jsonb     | float8         |               |
  | jsonb     | numeric        |               |
  | int4range | int4multirange |               |
  | numrange  | nummultirange  |               |
  | tsrange   | tsmultirange   |               |
  | tstzrange | tstzmultirange |               |
  | daterange | datemultirange |               |
  | int8range | int8multirange |               |
  | xid8      | xid            |               |
  """

  def bool_to_int4(true), do: 1
  def bool_to_int4(false), do: 0
  def int4_to_bool(0), do: false
  def int4_to_bool(x) when is_integer(x) and x > 0, do: true

  # Convert the table from moduledoc into a map
  @implicit_casts @moduledoc
                  |> String.split("## List of explicit casts")
                  |> List.last()
                  |> String.split("---- |\n")
                  |> List.last()
                  |> String.split("\n", trim: true)
                  |> Enum.flat_map(fn line ->
                    [from, to, function_name] =
                      line
                      |> String.split("|", trim: true)
                      |> Enum.map(&String.trim/1)

                    if function_name != "" do
                      [
                        {{String.to_atom(from), String.to_atom(to)},
                         {__MODULE__, String.to_existing_atom(function_name)}}
                      ]
                    else
                      []
                    end
                  end)
                  |> Map.new()

  def known, do: @implicit_casts
end
