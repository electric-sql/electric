defmodule Electric.Replication.Eval.Env.ImplicitCasts do
  @moduledoc """
  List of all implicit casts in (raw) PostgreSQL. Does not account for custom casts, which
  are discouraged anyway. If needed, this list can be extended in `Electric.Replication.Eval.Env.new/1`

  This list of implicit casts functions as-is, meaning that in Elixir land, we can just "relabel" the type,
  without doing any actual conversion, and it will work.

  Types are always considered implicitly castable to themselves (as in PG code), but two casts are missing
  from this list: `time` to `timetz` and `timestamp` to `timestamptz`. Reason for this is that the implicit
  cast appends a timezone of the server to the original type, which is not something that makes a whole
  lot of sense to do on Electric.

  ## List of implicit casts

  | source      | targets                           |
  | ----------- | --------------------------------- |
  | bit         | varbit,bit                        |
  | bpchar      | text,name,varchar,bpchar          |
  | char        | text                              |
  | cidr        | inet                              |
  | date        | timestamptz,timestamp             |
  | float4      | float8                            |
  | int2        | float8,int8,int4,numeric,float4   |
  | int4        | float4,float8,numeric,int8        |
  | int8        | float8,float4,numeric             |
  | interval    | interval                          |
  | macaddr     | macaddr8                          |
  | macaddr8    | macaddr                           |
  | name        | text                              |
  | numeric     | numeric,float8,float4             |
  | text        | bpchar,varchar,name               |
  | time        | interval,time,timetz              |
  | timestamp   | timestamp,timestamptz             |
  | timestamptz | timestamptz                       |
  | timetz      | timetz                            |
  | varbit      | varbit,bit                        |
  | varchar     | name,text,bpchar,varchar          |
  """

  # Convert the table from moduledoc into a map
  @implicit_casts @moduledoc
                  |> String.split("## List of implicit casts")
                  |> List.last()
                  |> String.split("---- |\n")
                  |> List.last()
                  |> String.split("\n", trim: true)
                  |> Enum.flat_map(fn line ->
                    [type, targets] =
                      line
                      |> String.split("|", trim: true)
                      |> Enum.map(&String.trim/1)

                    Enum.map(String.split(targets, ","), fn target ->
                      {{String.to_atom(type), String.to_atom(target)}, :as_is}
                    end)
                  end)
                  |> Map.new()

  def known, do: @implicit_casts
end
