defmodule Electric.Shapes.Api.Params do
  use Ecto.Schema

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Api
  alias Electric.Shapes.Shape

  import Ecto.Changeset

  @tmp_compaction_flag :experimental_compaction

  @primary_key false
  defmodule ColumnList do
    use Ecto.Type

    def type, do: {:array, :string}

    def cast([_ | _] = columns) do
      validate_column_names(columns)
    end

    def cast(columns) when is_binary(columns) do
      with {:error, reason} <- Electric.Plug.Utils.parse_columns_param(columns) do
        {:error, message: reason}
      end
    end

    def cast(_), do: :error

    def load([_ | _] = columns), do: {:ok, columns}

    def dump([_ | _] = columns), do: {:ok, columns}

    defp validate_column_names(columns) do
      Enum.reduce_while(columns, {:ok, columns}, fn
        "", _acc -> {:halt, {:error, message: "Invalid zero-length identifier"}}
        _, acc -> {:cont, acc}
      end)
    end
  end

  defmodule JsonOrMapStringParams do
    @moduledoc """
    Custom Ecto type that accepts params as either:
    1. A JSON string (e.g., "{\"1\":\"value1\",\"2\":\"value2\"}")
    2. A map with string values (for backwards compatibility)
    """
    use Ecto.Type

    def type, do: {:map, :string}

    def cast(params) when is_binary(params) do
      case Jason.decode(params) do
        {:ok, decoded} when is_map(decoded) ->
          # Ensure all values are strings
          string_map =
            Enum.into(decoded, %{}, fn {k, v} ->
              {to_string(k), to_string(v)}
            end)

          {:ok, string_map}

        {:ok, _} ->
          {:error, message: "params must be a JSON object"}

        {:error, _} ->
          {:error, message: "params must be valid JSON"}
      end
    end

    def cast(params) when is_map(params) do
      # Backwards compatibility: accept map directly
      string_map =
        Enum.into(params, %{}, fn {k, v} ->
          {to_string(k), to_string(v)}
        end)

      {:ok, string_map}
    end

    def cast(_), do: :error

    def load(data) when is_map(data), do: {:ok, data}
    def load(_), do: :error

    def dump(data) when is_map(data), do: {:ok, data}
    def dump(_), do: :error
  end

  defmodule SubsetParams do
    use Ecto.Schema
    alias Electric.Shapes.Shape

    embedded_schema do
      field(:order_by, :string)
      field(:limit, :integer)
      field(:offset, :integer)
      field(:where, :string)
      field(:params, JsonOrMapStringParams, default: %{})

      field(:result, :any, virtual: true)
    end

    def changeset(struct, params, shape_definition, api) do
      struct
      |> cast(params, __schema__(:fields) -- [:result])
      |> validate_number(:limit, greater_than: 0)
      |> validate_number(:offset, greater_than_or_equal_to: 0)
      |> validate_ordered_when_limited()
      |> cast_subset(shape_definition, api)
    end

    defp cast_subset(%Ecto.Changeset{valid?: false} = changeset, _shape_definition, _api),
      do: changeset

    defp cast_subset(changeset, shape_definition, api) do
      case Shape.Subset.new(shape_definition, changeset.changes, api) do
        {:ok, subset} ->
          put_change(changeset, :result, subset)

        {:error, {field, reason}} ->
          add_error(changeset, field, reason)
      end
    end

    defp validate_ordered_when_limited(changeset) do
      if changed?(changeset, :limit) or changed?(changeset, :offset) do
        validate_required(changeset, [:order_by],
          message: "order_by is required when limit or offset is present"
        )
      else
        changeset
      end
    end

    def extract_result({:ok, data}, from: key) do
      {:ok,
       Map.update!(data, key, fn
         nil -> nil
         %{result: result} -> result
       end)}
    end

    def extract_result(data, _), do: data
  end

  embedded_schema do
    field(:table, :string)
    field(:offset, :string)
    field(:handle, :string)
    field(:live, :boolean, default: false)
    field(:where, :string)
    field(:columns, ColumnList)
    field(:shape_definition, :string)
    field(:replica, Ecto.Enum, values: [:default, :full], default: :default)
    field(:params, {:map, :string}, default: %{})
    field(@tmp_compaction_flag, :boolean, default: false)
    field(:live_sse, :boolean, default: false)
    field(:log, Ecto.Enum, values: [:changes_only, :full], default: :full)

    embeds_one(:subset, SubsetParams)
  end

  @type t() :: %__MODULE__{}

  def validate(%Electric.Shapes.Api{} = api, params) do
    params
    |> cast_params()
    |> validate_required([:offset])
    |> cast_offset()
    |> validate_handle_with_offset()
    |> validate_live_with_offset()
    |> validate_live_sse()
    |> cast_root_table(api)
    |> cast_subset(api)
    |> apply_action(:validate)
    |> SubsetParams.extract_result(from: :subset)
    |> convert_error(api)
  end

  # we allow deletion by shape definition, shape definition and handle or just
  # handle
  def validate_for_delete(%Electric.Shapes.Api{} = api, params) do
    params
    |> cast_params()
    |> case do
      # if the params specify a table then the request includes the shape
      # definition (and maybe handle) for a deletion we don't need to validate
      # the offset or live flags etc
      %{changes: %{table: _table}} = changeset ->
        changeset
        |> validate_required([:table])
        |> cast_root_table(api)
        |> apply_action(:validate)
        |> convert_error(api)

      # if no table is specified, then just validate that there's a handle
      changeset ->
        changeset
        |> validate_required([:handle],
          message: "can't be blank when shape definition is missing"
        )
        |> apply_action(:validate)
        |> convert_error(api)
    end
  end

  defp cast_params(params) do
    %__MODULE__{}
    |> cast(params, __schema__(:fields) -- [:shape_definition, :subset])
  end

  defp convert_error({:ok, params}, _api), do: {:ok, params}

  defp convert_error({:error, changeset}, api) do
    reason =
      traverse_errors(changeset, fn {msg, opts} ->
        Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
          opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
        end)
      end)

    response =
      case reason do
        %{connection_not_available: [msg]} -> Api.Response.error(api, msg, status: 503)
        _ -> Api.Response.invalid_request(api, errors: reason)
      end

    {:error, response}
  end

  def cast_offset(%Ecto.Changeset{valid?: false} = changeset), do: changeset

  def cast_offset(%Ecto.Changeset{} = changeset) do
    offset = fetch_change!(changeset, :offset)

    case LogOffset.from_string(offset) do
      {:ok, offset} ->
        put_change(changeset, :offset, offset)

      {:error, message} ->
        add_error(changeset, :offset, message)
    end
  end

  def validate_handle_with_offset(%Ecto.Changeset{valid?: false} = changeset),
    do: changeset

  def validate_handle_with_offset(%Ecto.Changeset{} = changeset) do
    offset = fetch_change!(changeset, :offset)

    cond do
      offset in [LogOffset.before_all(), :now] ->
        delete_change(changeset, :handle)

      true ->
        validate_required(changeset, [:handle], message: "can't be blank when offset != -1")
    end
  end

  def validate_live_with_offset(%Ecto.Changeset{valid?: false} = changeset), do: changeset

  def validate_live_with_offset(%Ecto.Changeset{} = changeset) do
    offset = fetch_change!(changeset, :offset)

    cond do
      offset == LogOffset.before_all() ->
        validate_exclusion(changeset, :live, [true], message: "can't be true when offset == -1")

      offset == :now ->
        validate_exclusion(changeset, :live, [true],
          message: "can't be true when offset is 'now'"
        )

      true ->
        changeset
    end
  end

  def validate_live_sse(%Ecto.Changeset{valid?: false} = changeset), do: changeset

  def validate_live_sse(%Ecto.Changeset{} = changeset) do
    live = get_field(changeset, :live)

    if live do
      changeset
    else
      validate_exclusion(changeset, :live_sse, [true],
        message: "can't be true unless live is also true"
      )
    end
  end

  def cast_root_table(%Ecto.Changeset{valid?: false} = changeset, _), do: changeset

  def cast_root_table(%Ecto.Changeset{} = changeset, %Api{shape: nil} = api) do
    changeset
    |> validate_required([:table])
    |> define_shape(api)
  end

  def cast_root_table(%Ecto.Changeset{} = changeset, %Api{shape: %Shape{} = shape}) do
    put_change(changeset, :shape_definition, shape)
  end

  defp define_shape(%Ecto.Changeset{valid?: false} = changeset, _api) do
    changeset
  end

  defp define_shape(%Ecto.Changeset{} = changeset, api) do
    table = fetch_change!(changeset, :table)
    where = fetch_field!(changeset, :where)
    columns = get_change(changeset, :columns, nil)
    replica = fetch_field!(changeset, :replica)
    params = fetch_field!(changeset, :params)
    compaction_enabled? = fetch_field!(changeset, @tmp_compaction_flag)

    case Shape.new(
           table,
           where: where,
           params: params,
           columns: columns,
           replica: replica,
           inspector: api.inspector,
           allow_subqueries?: api.allow_subqueries?,
           storage: %{compaction: if(compaction_enabled?, do: :enabled, else: :disabled)},
           log_mode: fetch_field!(changeset, :log)
         ) do
      {:ok, shape} ->
        put_change(changeset, :shape_definition, shape)

      {:error, :connection_not_available} ->
        add_error(
          changeset,
          :connection,
          "Cannot connect to the database to verify the table. Please try again later."
        )

      {:error, {field, reasons}} ->
        Enum.reduce(List.wrap(reasons), changeset, fn
          {message, keys}, changeset ->
            add_error(changeset, field, message, keys)

          message, changeset when is_binary(message) ->
            add_error(changeset, field, message)
        end)

      {:error, %NimbleOptions.ValidationError{message: message, key: key}} ->
        add_error(changeset, key, message)
    end
  end

  defp cast_subset(%Ecto.Changeset{valid?: false} = changeset, _api), do: changeset

  defp cast_subset(%Ecto.Changeset{} = changeset, api) do
    cast_embed(changeset, :subset,
      with:
        &SubsetParams.changeset(
          &1,
          &2,
          Ecto.Changeset.fetch_change!(changeset, :shape_definition),
          api
        ),
      required: false
    )
  end
end
