defmodule Electric.Replication.Eval.Env.ImplicitCasts do
  @moduledoc """
  List of all implicit casts in (raw) PostgreSQL. Does not account for custom casts, which
  are discouraged anyway. If needed, this list can be extended in `Electric.Replication.Eval.Env.new/1`

  This list of implicit casts functions as-is, meaning that in Elixir land, we can just "relabel" the type,
  without doing any actual conversion, and it will work.

  Types are always considered implicitly castable to themselves (as in PG code), but three casts are missing
  from this list: `time` to `timetz`, `timestamp` to `timestamptz`, and `date` to `timestamptz`. Reason for this is that the implicit
  cast appends a timezone of the server to the original type, which is not something that makes a whole
  lot of sense to do on Electric.

  Duplicated source and target usually mean that there is some property of the type that may be present
  (e.g. length of the `bit` type, or precision of `interval`) but shouldn't interfere with casting

  ## List of implicit casts

  | source      | targets                           | function name     |
  | ----------- | --------------------------------- | ----------------- |
  | bit         | varbit,bit                        |                   |
  | bpchar      | text,name,varchar,bpchar          |                   |
  | char        | text                              |                   |
  | cidr        | inet                              |                   |
  | date        | timestamp                         | date_to_timestamp |
  | float4      | float8                            |                   |
  | int2        | float8,int8,int4,numeric,float4   |                   |
  | int4        | float4,float8,numeric,int8        |                   |
  | int8        | float8,float4,numeric             |                   |
  | interval    | interval                          |                   |
  | macaddr     | macaddr8                          |                   |
  | macaddr8    | macaddr                           |                   |
  | name        | text                              |                   |
  | numeric     | numeric,float8,float4             |                   |
  | text        | bpchar,varchar,name               |                   |
  | time        | interval                          |                   |
  | time        | time                              |                   |
  | timestamp   | timestamp                         |                   |
  | timestamptz | timestamptz                       |                   |
  | timetz      | timetz                            |                   |
  | varbit      | varbit,bit                        |                   |
  | varchar     | name,text,bpchar,varchar          |                   |
  """

  def date_to_timestamp(date), do: NaiveDateTime.new!(date, ~T[00:00:00])

  # Convert the table from moduledoc into a map
  @implicit_casts @moduledoc
                  |> Electric.Utils.parse_md_table(after: "## List of implicit casts")
                  |> Enum.flat_map(fn [type, targets, fun] ->
                    fun =
                      case fun do
                        "" -> :as_is
                        fun -> {__MODULE__, String.to_existing_atom(fun)}
                      end

                    Enum.map(String.split(targets, ","), fn target ->
                      {{String.to_atom(type), String.to_atom(target)}, fun}
                    end)
                  end)
                  |> Map.new()

  def known, do: @implicit_casts
end
