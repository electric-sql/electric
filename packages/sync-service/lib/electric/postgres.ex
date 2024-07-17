defmodule Electric.Postgres do
  def supported_types do
    ~w[
      bool
      bytea
      date
      float4 float8
      int2 int4 int8
      jsonb
      text
      time
      timestamp timestamptz
      uuid
      varchar
    ]a
  end

  def supported_types_only_in_functions, do: ~w|interval|a
end
