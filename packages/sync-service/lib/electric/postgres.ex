defmodule Electric.Postgres do
  @doc """
  All types currently supported by Electric

  ## Tests

      iex> :bool in supported_types()
      true
  """
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

  @doc """
  All types currently supported by Electric only in functions

  ## Tests

      iex> :interval in supported_types_only_in_functions()
      true
  """
  def supported_types_only_in_functions, do: ~w|interval|a
end
