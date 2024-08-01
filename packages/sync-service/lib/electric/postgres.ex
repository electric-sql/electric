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

  @display_settings [
    "SET bytea_output = 'hex'",
    "SET DateStyle = 'ISO, DMY'",
    "SET TimeZone = 'UTC'",
    "SET extra_float_digits = 1",
    "SET IntervalStyle = 'iso_8601'"
  ]

  @doc """
  Configuration settings that affect formatting of values of certain types.

  These settings should be set for the current session before executing any queries or
  statements to safe-guard against non-standard configuration being used in the Postgres
  database cluster or even the specific database Electric is configured to connect to.

  The settings Electric is sensitive to are:

    * `bytea_output`       - determines how Postgres encodes bytea values. It can use either Hex- or
                             Escape-based encoding.

    * `DateStyle`          - determines how Postgres interprets date values.

    * `TimeZone`           - affects the time zone offset Postgres uses for timestamptz and timetz values.

    * `extra_float_digits` - determines whether floating-point values are rounded or are encoded precisely.

    * `IntervalStyle`      - determines how Postgres interprets and formats interval values.
  """
  @spec display_settings :: [String.t()]
  def display_settings, do: @display_settings
end
