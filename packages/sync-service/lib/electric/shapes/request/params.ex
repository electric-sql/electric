defmodule Electric.Shapes.Request.Params do
  use Ecto.Schema

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Shape

  import Ecto.Changeset

  @primary_key false

  embedded_schema do
    field(:table, :string)
    field(:offset, :string)
    field(:handle, :string)
    field(:live, :boolean, default: false)
    field(:where, :string)
    field(:columns, :string)
    field(:shape_definition, :string)
    field(:replica, Ecto.Enum, values: [:default, :full], default: :default)
  end

  @type t() :: %__MODULE__{}

  def validate(params, opts) do
    %__MODULE__{}
    |> cast(params, __schema__(:fields) -- [:shape_definition],
      message: fn _, _ -> "must be %{type}" end
    )
    |> validate_required([:table, :offset])
    |> cast_offset()
    |> cast_columns()
    |> validate_handle_with_offset()
    |> validate_live_with_offset()
    |> cast_root_table(opts)
    |> apply_action(:validate)
    |> case do
      {:ok, params} ->
        {:ok, params}

      {:error, changeset} ->
        reason =
          traverse_errors(changeset, fn {msg, opts} ->
            Regex.replace(~r"%{(\w+)}", msg, fn _, key ->
              opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
            end)
          end)

        {:error, reason}
    end
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

  def cast_columns(%Ecto.Changeset{valid?: false} = changeset), do: changeset

  def cast_columns(%Ecto.Changeset{} = changeset) do
    case fetch_field!(changeset, :columns) do
      nil ->
        changeset

      columns ->
        case Electric.Plug.Utils.parse_columns_param(columns) do
          {:ok, parsed_cols} -> put_change(changeset, :columns, parsed_cols)
          {:error, reason} -> add_error(changeset, :columns, reason)
        end
    end
  end

  def validate_handle_with_offset(%Ecto.Changeset{valid?: false} = changeset),
    do: changeset

  def validate_handle_with_offset(%Ecto.Changeset{} = changeset) do
    offset = fetch_change!(changeset, :offset)

    if offset == LogOffset.before_all() do
      changeset
    else
      validate_required(changeset, [:handle], message: "can't be blank when offset != -1")
    end
  end

  def validate_live_with_offset(%Ecto.Changeset{valid?: false} = changeset), do: changeset

  def validate_live_with_offset(%Ecto.Changeset{} = changeset) do
    offset = fetch_change!(changeset, :offset)

    if offset != LogOffset.before_all() do
      changeset
    else
      validate_exclusion(changeset, :live, [true], message: "can't be true when offset == -1")
    end
  end

  def cast_root_table(%Ecto.Changeset{valid?: false} = changeset, _), do: changeset

  def cast_root_table(%Ecto.Changeset{} = changeset, opts) do
    table = fetch_change!(changeset, :table)
    where = fetch_field!(changeset, :where)
    columns = get_change(changeset, :columns, nil)
    replica = fetch_field!(changeset, :replica)

    case Shape.new(
           table,
           opts ++ [where: where, columns: columns, replica: replica]
         ) do
      {:ok, result} ->
        put_change(changeset, :shape_definition, result)

      {:error, {field, reasons}} ->
        Enum.reduce(List.wrap(reasons), changeset, fn
          {message, keys}, changeset ->
            add_error(changeset, field, message, keys)

          message, changeset when is_binary(message) ->
            add_error(changeset, field, message)
        end)
    end
  end
end
