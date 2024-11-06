defmodule Electric.Client.ValueMapper do
  @moduledoc """
  A behaviour for mapping the `value` fields of [`Message.ChangeMessage`](`Electric.Client.Message.ChangeMessage`) messages
  from the shape stream.

  This requires implementing a single function `c:for_schema/2`.

  Electric sends schema information with every response. For example the schema
  of the `foo` table from the [Electric
  Quickstart](https://electric-sql.com/docs/quickstart) is

      %{
        id: %{type: "int4", pk_index: 0, not_null: true},
        name: %{type: "varchar", max_length: 255},
        value: %{type: "float8"}
      }

  The `c:for_schema/2` function receives this schema as the first argument and it
  must return a 1-arity function that will map the value structs received from
  Electric to the desired format.

  E.g

      # the schema for the `foo` table
      schema = %{
        id: %{type: "int4", pk_index: 0, not_null: true},
        name: %{type: "varchar", max_length: 255},
        value: %{type: "float8"}
      }

      # get the mapper function for this schema
      mapper_fun = Electric.Client.ValueMapper.for_schema(schema, opts = [])

      value = %{
        "id" => "1",
        "name" => "James",
        "value" => "45.6"
      }

      # the mapping parses the integer and float values to their respective
      # Elixir/Erlang types.
      mapper_fun.(value)
      %{
        "id" => 1,
        "name" => "James",
        "value" => 45.6
      }

  The current implementation only handles integer and float values. Every other
  column is left as a binary.
  """

  alias Electric.Client
  alias Electric.Client.Message

  @type opts :: term()
  @type mapper_fun :: (Message.ChangeMessage.value() -> term())

  @doc """
  Given the schema information passed from the electric server should return a
  1-arity function that takes a values map, which is a map of column names to
  string values, and returns a version with the values cast to some appropriate
  Elixir type.
  """
  @callback for_schema(Client.schema(), opts()) :: mapper_fun()

  @behaviour __MODULE__

  @impl __MODULE__
  def for_schema(schema, _opts) do
    mapping = build_mapping(schema)
    &map_values(&1, mapping)
  end

  defp map_values(values, mapping) do
    Map.new(mapping, fn {k, fun} ->
      {k, fun.(Map.get(values, k))}
    end)
  end

  defp build_mapping(schema) when is_map(schema) do
    Map.new(schema, &column_mapping/1)
  end

  defp column_mapping({column_name, %{type: type} = _column_info}) do
    {to_string(column_name), map_type(type)}
  end

  # This is a deep hole to dig. Rather than attempt to provide mappings of all
  # PG types here I'm only doing ints and floats, mostly as a POC, and relying
  # on the Ecto integration to do the real work.
  #
  # If we have time and or a requirement to expand type support here then it's
  # fairly trivial to do but a lot of work.
  #
  # Note that the values we receive here have come out of postgres, so the
  # validation requirements are light-to-none.
  defp map_type(<<"int", n::binary-1>>) when n in ~w(2 4 8) do
    fn
      nil -> nil
      val -> String.to_integer(val)
    end
  end

  defp map_type(<<"float", n::binary-1>>) when n in ~w(4 8) do
    fn
      nil ->
        nil

      int when is_integer(int) ->
        :erlang.float(int)

      val ->
        {f, ""} = Float.parse(val)
        f
    end
  end

  defp map_type(_type) do
    & &1
  end
end
