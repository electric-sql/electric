defmodule Electric.Postgres.ReplicationClient do
  @moduledoc """
  A client module for Postgres logical replication
  """
  alias Electric.Postgres.ReplicationClient.Collector
  alias Electric.Postgres.LogicalReplication.Decoder
  require Logger
  use Postgrex.ReplicationConnection

  defmodule State do
    @enforce_keys [:transaction_received, :publication_name]
    defstruct [
      :transaction_received,
      :publication_name,
      origin: "postgres",
      txn_collector: %Collector{},
      step: :disconnected
    ]

    @type t() :: %__MODULE__{
            transaction_received: {module(), atom(), [term()]},
            publication_name: String.t(),
            origin: String.t(),
            txn_collector: Collector.t(),
            step: :disconnected | :create_slot | :streaming
          }

    @opts_schema NimbleOptions.new!(
                   transaction_received: [required: true, type: :mfa],
                   publication_name: [required: true, type: :string]
                 )

    @spec new(Access.t()) :: t()
    def new(opts) do
      opts = NimbleOptions.validate!(opts, @opts_schema)
      struct!(__MODULE__, opts)
    end
  end

  def start_link(opts) do
    # Automatically reconnect if we lose connection.
    extra_opts = [
      auto_reconnect: true
    ]

    init_opts = State.new(Keyword.get(opts, :init_opts, []))

    Postgrex.ReplicationConnection.start_link(__MODULE__, init_opts, extra_opts ++ opts)
  end

  @impl true
  def init(%State{} = state) do
    {:ok, state}
  end

  @impl true
  def handle_connect(state) do
    query = "CREATE_REPLICATION_SLOT electric TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT"
    {:query, query, %{state | step: :create_slot}}
  end

  @impl true
  def handle_result(results, %State{step: :create_slot} = state) when is_list(results) do
    query =
      "START_REPLICATION SLOT electric LOGICAL 0/0 (proto_version '1', publication_names '#{state.publication_name}')"

    Logger.info("Started replication from postgres")

    {:stream, query, [], %{state | step: :streaming}}
  end

  @impl true
  @spec handle_data(binary(), State.t()) ::
          {:noreply, State.t()} | {:noreply, list(binary()), State.t()}
  def handle_data(
        <<?w, _wal_start::64, _wal_end::64, _clock::64, rest::binary>>,
        %State{} = state
      ) do
    rest
    |> Decoder.decode()
    |> Collector.handle_message(state.txn_collector)
    |> case do
      %Collector{} = txn_collector ->
        {:noreply, %{state | txn_collector: txn_collector}}

      {txn, %Collector{} = txn_collector} ->
        {m, f, args} = state.transaction_received
        apply(m, f, [txn | args])
        {:noreply, %{state | txn_collector: txn_collector}}
    end
  end

  def handle_data(<<?k, wal_end::64, _clock::64, reply>>, state) do
    messages =
      case reply do
        1 -> [<<?r, wal_end + 1::64, wal_end + 1::64, wal_end + 1::64, current_time()::64, 0>>]
        0 -> []
      end

    {:noreply, messages, state}
  end

  @epoch DateTime.to_unix(~U[2000-01-01 00:00:00Z], :microsecond)
  defp current_time(), do: System.os_time(:microsecond) - @epoch
end
