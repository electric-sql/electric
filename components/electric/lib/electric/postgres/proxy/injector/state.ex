defmodule Electric.Postgres.Proxy.Injector.State do
  defmodule Tx do
    @moduledoc false
    # holds information about the current transaction

    defstruct electrified: false, version: nil

    @type t() :: %__MODULE__{electrified: boolean(), version: nil | String.t()}
  end

  defstruct loader: nil,
            injector: nil,
            tx: nil

  @type loader() :: {module(), term()}
  @type injector() :: {module(), term()}
  @type t() :: %__MODULE__{
          loader: loader(),
          injector: injector(),
          tx: nil | Tx.t()
        }

  @doc """
  Set the current state as being inside a transaction.
  """
  @spec begin(t()) :: t()
  def begin(%__MODULE__{} = state) do
    %{state | tx: %Tx{}}
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

  @doc """
  Update the transaction status to mark it as affecting electrified tables (or
  not).
  """
  @spec electrify(t(), boolean()) :: t()
  def electrify(%__MODULE__{} = state, electrified?) do
    Map.update!(state, :tx, &Map.put(&1, :electrified, &1.electrified || electrified?))
  end

  def electrified?(%__MODULE__{tx: %Tx{electrified: electrified?}}), do: electrified?
  def electrified?(%__MODULE__{}), do: false

  @doc """
  Wrapper around the SchemaLoader.table_electrified?/2 behaviour callback.
  """
  @spec table_electrified?(t(), {String.t(), String.t()}) :: boolean()
  def table_electrified?(%__MODULE__{loader: {module, conn}}, table) do
    {:ok, electrified?} = apply(module, :table_electrified?, [conn, table])
    electrified?
  end

  @doc """
  Wrapper around the SchemaLoader.index_electrified?/2 behaviour callback.
  """
  @spec index_electrified?(t(), {String.t(), String.t()}) :: boolean()
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
    Map.update!(state, :tx, &Map.put(&1, :version, to_string(version)))
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
end
