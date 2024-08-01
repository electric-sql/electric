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
      :try_creating_publication?,
      :start_streaming?,
      :display_settings,
      origin: "postgres",
      txn_collector: %Collector{},
      step: :disconnected
    ]

    @type t() :: %__MODULE__{
            transaction_received: {module(), atom(), [term()]},
            publication_name: String.t(),
            try_creating_publication?: boolean(),
            start_streaming?: boolean(),
            origin: String.t(),
            txn_collector: Collector.t(),
            step:
              :disconnected
              | :create_publication
              | :create_slot
              | :ready_to_stream
              | :streaming
              | :set_display_setting,
            display_settings: [String.t()]
          }

    @opts_schema NimbleOptions.new!(
                   transaction_received: [required: true, type: :mfa],
                   publication_name: [required: true, type: :string],
                   try_creating_publication?: [type: :boolean, required: true],
                   start_streaming?: [type: :boolean, default: true]
                 )

    @spec new(Access.t()) :: t()
    def new(opts) do
      opts = NimbleOptions.validate!(opts, @opts_schema)
      settings = [display_settings: Electric.Postgres.display_settings()]
      opts = settings ++ opts
      struct!(__MODULE__, opts)
    end
  end

  def start_link(connection_opts, replication_opts) do
    Postgrex.ReplicationConnection.start_link(__MODULE__, replication_opts, connection_opts)
  end

  def start_streaming(client) do
    send(client, :start_streaming)
  end

  @impl true
  def init(replication_opts) do
    {:ok, State.new(replication_opts)}
  end

  @impl true
  def handle_connect(%State{display_settings: [query | rest]} = state) do
    {:query, query, %{state | display_settings: rest, step: :set_display_setting}}
  end

  def handle_connect(state) do
    if state.try_creating_publication? do
      create_publication_step(state)
    else
      create_replication_slot_step(state)
    end
  end

  @impl true
  def handle_result(
        [%Postgrex.Result{command: :create_publication}],
        %State{step: :create_publication} = state
      ) do
    create_replication_slot_step(state)
  end

  def handle_result(result, %State{step: :set_display_setting} = state) do
    if is_struct(result, Postgrex.Error) do
      Logger.error("Failed to set display setting: #{inspect(result)}")
    end

    handle_connect(state)
  end

  def handle_result(%Postgrex.Error{} = error, %State{step: :create_publication} = state) do
    error_message = "publication \"#{state.publication_name}\" already exists"

    case error.postgres do
      %{code: :duplicate_object, pg_code: "42710", message: ^error_message} ->
        create_replication_slot_step(state)

      other ->
        {:disconnect, other}
    end
  end

  def handle_result([_result], %State{step: :create_slot} = state) do
    if state.start_streaming? do
      start_streaming_step(state)
    else
      {:noreply, %{state | step: :ready_to_stream}}
    end
  end

  @impl true
  def handle_info(:start_streaming, state) do
    if state.step == :ready_to_stream do
      start_streaming_step(state)
    else
      Logger.debug("Replication client requested to start streaming while step=#{state.step}")
      {:noreply, state}
    end
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

  defp create_publication_step(state) do
    # We're creating an "empty" publication because first snapshot creation should add the table
    query = "CREATE PUBLICATION #{state.publication_name}"
    {:query, query, %{state | step: :create_publication}}
  end

  defp create_replication_slot_step(state) do
    query = "CREATE_REPLICATION_SLOT electric TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT"
    {:query, query, %{state | step: :create_slot}}
  end

  defp start_streaming_step(state) do
    query =
      "START_REPLICATION SLOT electric LOGICAL 0/0 (proto_version '1', publication_names '#{state.publication_name}')"

    Logger.info("Started replication from postgres")

    {:stream, query, [], %{state | step: :streaming}}
  end
end
