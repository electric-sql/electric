defmodule Electric.Schema do
  import Bitwise
  alias Electric.Replication.Eval.Env.BasicTypes
  alias Electric.Postgres.Inspector

  @type column_name :: String.t()
  @type type_name :: String.t()
  @type schema :: %{
          :type => type_name(),
          optional(:dims) => non_neg_integer(),
          optional(:pk_index) => non_neg_integer(),
          optional(:max_length) => String.t(),
          optional(:length) => String.t(),
          optional(:precision) => String.t(),
          optional(:scale) => String.t(),
          optional(:fields) => String.t(),
          optional(:type_mod) => integer()
        }

  @bit_types ["bit", "varbit"]
  @variable_length_character_types ["varchar", "text"]
  @fixed_length_character_types ["bpchar"]
  @time_types [
    "timetz"
    | BasicTypes.known()
      |> Map.filter(fn {_, v} -> v.category in [:datetime, :timestamp] end)
      |> Map.keys()
      |> Enum.map(fn type -> to_string(type) end)
  ]

  @interval_field_masks [
    %{unit: "YEAR", mask: 1 <<< 2},
    %{unit: "MONTH", mask: 1 <<< 1},
    %{unit: "DAY", mask: 1 <<< 3},
    %{unit: "HOUR", mask: 1 <<< 10},
    %{unit: "MINUTE", mask: 1 <<< 11},
    %{unit: "SECOND", mask: 1 <<< 12}
  ]
  # all bits set in a binary signed 2s' complement (16 bits)
  @all_set 0b0111111111111111

  @doc """
  Convert column information into a schema map
  """
  @spec from_column_info(Inspector.column_info()) :: %{column_name() => schema()}
  def from_column_info(column_info) do
    Map.new(column_info, fn col -> {col.name, schema(col)} end)
  end

  @spec schema(Inspector.column_info()) :: schema()
  defp schema(col_info) do
    %{type: type(col_info)}
    |> add_dims(col_info)
    |> add_pk(col_info)
    |> add_nullability(col_info)
    |> add_modifier(col_info)
  end

  defp type(%{type: type, array_dimensions: 0}), do: type
  defp type(%{array_type: type}), do: type

  defp add_dims(schema, %{array_dimensions: 0}), do: schema

  defp add_dims(schema, %{array_dimensions: array_dimensions}) do
    Map.put(schema, :dims, array_dimensions)
  end

  defp add_pk(schema, %{pk_position: nil}), do: schema

  defp add_pk(schema, %{pk_position: idx}) do
    Map.put(schema, :pk_index, idx)
  end

  defp add_nullability(schema, %{not_null: true}), do: Map.put(schema, :not_null, true)
  defp add_nullability(schema, _), do: schema

  defp add_modifier(%{type: type} = schema, %{type_mod: type_mod})
       when type_mod > 0 and type in @variable_length_character_types do
    Map.put(schema, :max_length, type_mod - 4)
  end

  defp add_modifier(%{type: type} = schema, %{type_mod: type_mod})
       when type_mod > 0 and type in @fixed_length_character_types do
    Map.put(schema, :length, type_mod - 4)
  end

  defp add_modifier(%{type: type} = schema, %{type_mod: type_mod}) when type in @bit_types do
    Map.put(schema, :length, type_mod)
  end

  defp add_modifier(%{type: "interval"} = schema, %{type_mod: type_mod}) when type_mod > -1 do
    # Postgres stores the range of the interval in the high 16 bits of the type_mod
    # and the precision in the low 16 bits of the type_mod
    # cf. https://github.com/postgres/postgres/blob/master/src/backend/utils/adt/timestamp.c#L1045
    <<range::signed-integer-16, precision::signed-integer-16>> = <<type_mod::signed-integer-32>>

    schema
    |> Map.merge(interval_fields(range))
    |> Map.merge(interval_precision(precision))
  end

  defp add_modifier(%{type: type} = schema, %{type_mod: type_mod})
       when type_mod > 0 and type in @time_types do
    Map.put(schema, :precision, type_mod)
  end

  defp add_modifier(%{type: "numeric"} = schema, %{type_mod: type_mod}) when type_mod > -1 do
    # The scale and precision are two 16 bit values encoded in one 32 bit value
    # that is stored in the type_mod column: type_mod = precision . scale
    <<precision::signed-integer-16, scale::signed-integer-16>> =
      <<type_mod - 4::signed-integer-32>>

    Map.merge(schema, %{precision: precision, scale: scale})
  end

  defp add_modifier(schema, %{type_mod: type_mod}) when type_mod > -1 do
    # It's not a built-in type so we don't know how to interpret its type modifier.
    # Therefore we include the type modifier as is in the schema.
    Map.put(schema, :type_mod, type_mod)
  end

  defp add_modifier(schema, _), do: schema

  # When precision is -1 that means it was not provided
  defp interval_precision(-1), do: %{}
  defp interval_precision(precision), do: %{precision: precision}

  # When all range bits are set
  # that means no interval fields were provided
  defp interval_fields(@all_set), do: %{}

  defp interval_fields(range) do
    @interval_field_masks
    |> Enum.filter(fn %{mask: mask} -> (range &&& mask) > 0 end)
    |> Enum.map(& &1.unit)
    |> case do
      [unit] -> %{fields: unit}
      units -> %{fields: "#{List.first(units)} TO #{List.last(units)}"}
    end
  end
end
