defmodule Electric.Postgres.Proxy.Injector.State do
  alias PgProtocol.Message, as: M
  alias Electric.Postgres
  alias Electric.Postgres.Extension.SchemaLoader

  defmodule Tx do
    # holds information about the current transaction
    @moduledoc false

    alias Electric.Satellite.SatPerms

    defstruct electrified: false,
              version: nil,
              id: 0,
              tables: %{},
              # rules: nil,
              # rules_modifications: 0,
              schema: nil,
              failed: false,
              initial_permissions: %{},
              current_permissions: %{}

    @type t() :: %__MODULE__{
            electrified: boolean(),
            version: nil | String.t(),
            tables: %{Postgres.relation() => true},
            id: pos_integer(),
            # rules: nil | %SatPerms.Rules{},
            # rules_modifications: non_neg_integer(),
            schema: nil | Postgres.Schema.t(),
            failed: boolean(),
            initial_permissions: %{module() => term()},
            current_permissions: %{module() => term()}
          }

    def new(loader) do
      # TODO: These schema version could be inconsistent with the database
      #       there could be a migration in the replication stream that hasn't reached
      #       our state maintenance consumer (MigrationConsumer)
      #       Perhaps we could move the schema mutation/update to within the proxy itself
      #       and provide a way to retrieve based on txid or something.
      {:ok, schema_version} = SchemaLoader.load(loader)

      %__MODULE__{
        schema: schema_version.schema,
        id: System.unique_integer([:positive, :monotonic])
      }
    end

    def electrify_table(tx, {schema, table}) do
      Map.update!(tx, :tables, &Map.put(&1, {schema, table}, true))
    end

    def table_electrified?(tx, {schema, table}) do
      Map.get(tx.tables, {schema, table}, false)
    end

    # NOTE: this uses an abstract `syntax` module as a nod towards future
    # extensibility, where the proxy can support multiple syntaxes for managing
    # the permissions state.
    # At the moment `Electric.DDLX` is hard-coded as the syntax module at the 
    # call sites for this function.
    def initial_permissions(tx, syntax, permissions) do
      tx
      |> Map.update!(:initial_permissions, &Map.put(&1, syntax, permissions))
      |> Map.update!(:current_permissions, &Map.put(&1, syntax, {0, permissions}))
    end

    def current_permissions(%Tx{} = tx, syntax) do
      with {:ok, {_, perms}} <- Map.fetch(tx.current_permissions, syntax) do
        {:ok, perms}
      end
    end

    def update_permissions(%Tx{} = tx, syntax, command) when is_atom(syntax) do
      Map.update!(tx, :current_permissions, fn current ->
        Map.update!(current, syntax, fn {modifications, permissions} ->
          {:ok, n, updated_permissions} =
            apply(syntax, :update_permissions, [command, permissions])

          {modifications + n, updated_permissions}
        end)
      end)
    end

    def modified_permissions(%Tx{} = tx, syntax) when is_atom(syntax) do
      case Map.fetch!(tx.current_permissions, syntax) do
        {0, _} ->
          nil

        {_n, current_permissions} ->
          {
            Map.fetch!(tx.initial_permissions, syntax),
            apply(syntax, :finalise_permissions, [current_permissions])
          }
      end
    end

    def permissions_saved(%Tx{} = tx, syntax) when is_atom(syntax) do
      Map.update!(tx, :current_permissions, fn current ->
        Map.update!(current, syntax, fn {_, permissions} ->
          {0, permissions}
        end)
      end)
    end
  end

  @derive {Inspect, except: [:loader]}

  defstruct loader: nil,
            query_generator: nil,
            default_schema: "public",
            tx: nil,
            session_id: nil,
            metadata: %{},
            pending_messages: []

  @type loader() :: {module(), term()}
  @type query_generator() :: module()
  @type t() :: %__MODULE__{
          loader: loader(),
          query_generator: query_generator(),
          default_schema: String.t(),
          session_id: integer(),
          tx: nil | Tx.t(),
          metadata: map(),
          pending_messages: [M.t()]
        }

  @doc """
  Set the current state as being inside a transaction.
  """
  @spec begin(t()) :: t()
  def begin(%__MODULE__{} = state) do
    %{state | tx: Tx.new(state.loader)}
  end

  @doc """
  Exit the current transaction.
  """
  @spec commit(t()) :: t()
  def commit(%__MODULE__{} = state) do
    %{state | tx: nil}
  end

  @doc """
  Exit the current transaction.
  """
  @spec rollback(t()) :: t()
  def rollback(%__MODULE__{} = state) do
    %{state | tx: nil}
  end

  @doc """
  Are we in a transaction or not?
  """
  @spec tx?(t()) :: boolean()
  def tx?(%__MODULE__{} = state) do
    not is_nil(state.tx)
  end

  def transaction(%__MODULE__{} = state, action) when action in [:begin, :rollback, :commit] do
    case action do
      :begin -> begin(state)
      :rollback -> rollback(state)
      :commit -> commit(state)
    end
  end

  @doc """
  Update the transaction status to mark it as affecting electrified tables (or
  not).
  """
  @spec electrify(t()) :: t()
  def electrify(%__MODULE__{} = state) do
    maybe_update_tx(state, &Map.put(&1, :electrified, true))
  end

  @spec electrify(t(), {String.t(), String.t()}) :: t()
  def electrify(%__MODULE__{} = state, {_schema, _name} = table) do
    state
    |> electrify()
    |> maybe_update_tx(&Tx.electrify_table(&1, table))
  end

  def electrified?(%__MODULE__{tx: %Tx{electrified: electrified?}}), do: electrified?
  def electrified?(%__MODULE__{}), do: false

  defp maybe_update_tx(state, update_fun) do
    Map.update!(state, :tx, fn
      nil -> nil
      tx when is_map(tx) -> update_fun.(tx)
    end)
  end

  @doc """
  Wrapper around the SchemaLoader.table_electrified?/2 behaviour callback.
  """
  @spec table_electrified?(t(), {String.t(), String.t()}) :: boolean()
  def table_electrified?(%__MODULE__{loader: {module, conn}} = state, table) do
    if tx?(state) && Tx.table_electrified?(state.tx, table) do
      true
    else
      {:ok, electrified?} = apply(module, :table_electrified?, [conn, table])
      electrified?
    end
  end

  @doc """
  Wrapper around the SchemaLoader.index_electrified?/2 behaviour callback.
  """
  @spec index_electrified?(t(), {String.t(), String.t()}) :: {:ok, boolean()}
  def index_electrified?(%__MODULE__{loader: {module, conn}}, index) do
    {:ok, electrified?} = apply(module, :index_electrified?, [conn, index])
    electrified?
  end

  @doc """
  Retrieve the migration version assigned to the current transaction.

  Returns `:error` if we're outside a transaction or no version has been
  assigned.
  """
  @spec tx_version(t) :: {:ok, String.t()} | :error
  def tx_version(%__MODULE__{tx: %Tx{version: nil}}) do
    :error
  end

  def tx_version(%__MODULE__{tx: %Tx{version: version}}) do
    {:ok, version}
  end

  def tx_version(%__MODULE__{}) do
    :error
  end

  @doc """
  Assign a version to the current transaction.
  """
  @spec tx_version(t(), integer() | String.t()) :: t()
  def tx_version(%__MODULE__{} = state, version) do
    maybe_update_tx(state, &Map.put(&1, :version, to_string(version)))
  end

  @doc """
  Returns true if the state has an assigned migration version.
  """
  @spec tx_version?(t()) :: boolean()
  def tx_version?(%__MODULE__{} = state) do
    case tx_version(state) do
      {:ok, _version} -> true
      :error -> false
    end
  end

  def capture_version?(%__MODULE__{} = state) do
    case {tx_version?(state), electrified?(state)} do
      {_, false} ->
        false

      {true, true} ->
        false

      {false, true} ->
        true
    end
  end

  def assign_version_metadata(%__MODULE__{} = state, version) do
    Map.update!(state, :metadata, &Map.put(&1, :version, to_string(version)))
  end

  def retrieve_version_metadata(%__MODULE__{} = state) do
    Map.get_and_update!(state, :metadata, fn m ->
      {Map.fetch(m, :version), Map.delete(m, :version)}
    end)
  end

  def failed(%__MODULE__{tx: nil} = state) do
    state
  end

  def failed(%__MODULE__{tx: tx} = state) do
    %{state | tx: %{tx | failed: true}}
  end

  def failed?(%__MODULE__{tx: nil}), do: false
  def failed?(%__MODULE__{tx: tx}), do: tx.failed

  def set_initial_permissions(%__MODULE__{tx: nil}, _rules) do
    raise "no in transaction"
  end

  def set_initial_permissions(%__MODULE__{} = state, rules) do
    Map.update!(state, :tx, fn tx ->
      Tx.initial_permissions(tx, Electric.DDLX, rules)
    end)
  end

  # TODO: this is less than ideal. We should really just open a tx
  # for every statement and load the perms within it is usual. 
  # That way we have access to the permissions state in a consistent
  # way.
  def current_permissions(%__MODULE__{tx: nil, loader: loader}) do
    SchemaLoader.global_permissions(loader)
  end

  def current_permissions(%__MODULE__{tx: tx}) do
    Tx.current_permissions(tx, Electric.DDLX)
  end

  def update_permissions(%__MODULE__{} = state, %Electric.DDLX.Command{} = command) do
    %{state | tx: Tx.update_permissions(state.tx, Electric.DDLX, command)}
  end

  def permissions_modified(%__MODULE__{} = state) do
    Tx.modified_permissions(state.tx, Electric.DDLX)
  end

  def permissions_saved(%__MODULE__{tx: tx} = state) do
    %{state | tx: Tx.permissions_saved(tx, Electric.DDLX)}
  end
end
