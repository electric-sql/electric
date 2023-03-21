defmodule Electric.Replication.Row do
  use Vax.Schema

  @type t() :: %__MODULE__{}

  schema "rows" do
    field(:table, :string)
    field(:schema, :string)
    field(:last_operation, :string)
    field(:deleted?, Vax.Types.Flag, conflict_resolution: :disable_wins)
    field(:row, Vax.Types.Map)
  end

  @spec new(schema :: String.t(), table :: String.t(), record :: map(), keys :: [String.t(), ...]) ::
          t()
  def new(schema, table, record, primary_keys) do
    %__MODULE__{
      id: extract_id(schema, table, primary_keys, record),
      table: table,
      schema: schema,
      row: record,
      deleted?: false
    }
  end

  # hack, fix in vax (change is not being propagated because of default value)
  def force_deleted_update(%__MODULE__{} = row, value) do
    row
    |> Ecto.Changeset.change()
    |> force_deleted_update(value)
  end

  def force_deleted_update(%Ecto.Changeset{} = changeset, value) do
    %{changeset | changes: Map.put(changeset.changes, :deleted?, value)}
  end

  defp extract_id(schema, table, keys, record) when keys !== [] do
    # NOTE: order of keys here is important PK does not contain NULL values, and
    # we should never get :nil in record map. The order of keys should be
    # deterministic and is guaranteed by the calling code.
    #
    # Code here has been rewritten to provide a simple runtime check that
    # we do not skip keys that accidentally were omitted.
    primary_keys_joined =
      Enum.reduce(Enum.reverse(keys), "", fn key, acc ->
        value = Map.fetch!(record, key)
        ":" <> value <> acc
      end)

    schema <> ":" <> table <> primary_keys_joined
  end
end
