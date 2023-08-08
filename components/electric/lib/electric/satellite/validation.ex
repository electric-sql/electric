defmodule Electric.Satellite.Validation do
  @spec assert_type!(String.t(), atom) :: :ok | no_return
  def assert_type!(val, col_type) do
    postgrex_ext = Electric.Postgres.OidDatabase.postgrex_ext_for_name(col_type)

    # encode_value() will raise if val is invalid. We're not interested in the return value itself.
    _ =
      val
      |> parse_column_value(col_type)
      |> Postgrex.DefaultTypes.encode_value(postgrex_ext)

    :ok
  end

  ###

  # Parse text-encoded value into an Elixir term before it can be passed to Postgrex's encode_value().
  @spec parse_column_value(String.t(), atom) :: term

  defp parse_column_value(val, type) when type in [:text, :bpchar, :varchar, :bytea] do
    val
  end

  defp parse_column_value(val, type) when type in [:int2, :int4, :int8] do
    String.to_integer(val)
  end

  defp parse_column_value(val, type) when type in [:float4, :float8] do
    String.to_float(val)
  end
end
