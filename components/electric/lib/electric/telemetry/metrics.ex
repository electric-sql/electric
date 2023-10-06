defmodule Electric.Telemetry.Metrics do
  @moduledoc """
  The following telemetry events are emitted by Electric

  ## `[:electric, :resources, *]`

  Represents periodic events, emitted by a telemetry poller

  - `[:electric, :resources, :wal_cache]`

      Represents the state of WAL cache component, that acts as a distribution point
      for clients.

      This event contains the following measurements:

      - `transaction_count`: Number of transactions currently in cache
      - `max_transaction_count`: Maximum number of transactions the cache will store
      - `oldest_transaction_timestamp`: `DateTime` timestamp of the oldest transaction currently in cache
      - `cache_memory_total`: Current estimated memory usage by the WAL cache, in bytes

  - `[:electric, :resources, :clients]`

      Represents currently connected Satellite clients.

      This event contains the following measurements:

      - `count`: Number of currently connected Satellite clients.

  ## `[:electric, :postgres, :replication_from, *]`

  Represents events related to Electric's connection to Postgres and
  streaming rows from Postgres.

  The connection span is started and ended by following events:

  - `[:electric, :postgres, :replication_from, :start]`

      Emitted when Electric connects to PostgreSQL and starts replication

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.
      - `electrified_tables`: Number of currently electrified tables in the database

      This event contains the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `host`: Postgres host + port
      - `short_version`: Version of the connected postgres server
      - `long_version`: Version of the connected postgres server including OS

  - `[:electric, :postgres, :replication_from, :stop]`

      Represents the end of the Electric being connected to postgres span

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.
      - `duration`: The span duration, in `:native` units.

      This event contains the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `host`: Postgres host + port
      - `short_version`: Version of the connected postgres server
      - `long_version`: Version of the connected postgres server including OS


  The following events may be emitted within this span

  - `[:electric, :postgres, :replication_from, :transaction]`

      Emitted when a transaction gets sent from Postgres

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units
      - `operations`: Total number of operations in this transaction
      - `inserts`: Number of inserts included in this transaction
      - `updates`: Number of updates included in this transaction
      - `deletes`: Number of deletes included in this transaction

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span


  ## `[:electric, :postgres, :migration]`

  Emitted when a migration gets sent from Postgres

  This event contains the following measurements:

  - `electrified_tables`: Number of currently electrified tables in the database

  And the following metadata:

  - `migration_version`: new migration version


  ## `[:electric, :postgres, :replication_to, *]`

  Represents events related to Postgres's connection to Electric and
  streaming rows to Postgres.

  - `[:electric, :postgres, :replication_to, :start]`

      Emitted when Electric connects to PostgreSQL and starts replication

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.

      This even contains the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `host`: Postgres host + port

  - `[:electric, :postgres, :replication_to, :stop]`

      Represents the end of the Electric being connected to postgres span

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.
      - `duration`: The span duration, in `:native` units.

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `host`: Postgres host + port

  The following events may be emitted within this span

  - `[:electric, :postgres, :replication_to, :send]`

      Represents sending a transaction to Postgres

      This event contains the following measurements:

      - `wal_messages`: Number of wal messages about to be sent
      - `transactions`: Number of transactions being sent. Currently always 1.

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span

  ## `[:electric, :satellite, :connection, *]`

  Represents events related to connections from Satellites (clients) to Electric

  The connection span is started and ended by following events:

  - `[:electric, :satellite, :connection, :start]`

      Emitted when a satellite client connects to Electric

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `client_version`: Version of the connected client

  - `[:electric, :satellite, :connection, :stop]`

      Emitted when a satellite client disconnects from Electric

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.
      - `duration`: Total connection time, in `:native` units.

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `client_version`: Version of the connected client
      - `initiator`: Identifier of who closed the connection: `:client` or `:server`

  ## `[:electric, :satellite, :replication, *]`

  Represents replication between Satellite and Electric. Started within the context of the connection.

    The connection span is started and ended by following events:

  - `[:electric, :satellite, :replication, :start]`

      Emitted when a satellite client connects to Electric

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.
      - `continued_subscriptions`: Number of subscriptions the client has requested to continue.

      And the following metadata:

      - `initial_sync`: true if client is connected for the first time
      - `telemetry_span_context`: Unique identifier for this span
      - `parent_telemetry_span_context`: Unique identifier for the connection within which the replication was started
      - `client_id`: Unique identifier of the client's device
      - `user_id`: Unique identifier of the user

  - `[:electric, :satellite, :replication, :stop]`

      Emitted when a satellite client disconnects from Electric

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.
      - `duration`: Total connection time, in `:native` units.

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `parent_telemetry_span_context`: Unique identifier for the connection within which the replication was started
      - `client_id`: Unique identifier of the client's device
      - `user_id`: Unique identifier of the user

  The following events may be emitted within this span:

  - `[:electric, :satellite, :replication, :transaction_send]`

      Emitted when a transaction is sent from Electric to Satellite. Note that
      this event is only emitted if any of the operations within the transaction
      apply to the client, i.e. transactions that emptied don't get sent and
      don't emit this event.

      This event contains the following measurements:

      - `original_operations`: Number of the operations in the transaction before filtering
      - `operations`: Number of operations in the transaction kept after filtering
      - `inserts`: Number of inserts among sent operations in this transaction
      - `updates`: Number of updates among sent operations in this transaction
      - `deletes`: Number of deletes among sent operations in this transaction

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `client_id`: Unique identifier of the client's device
      - `user_id`: Unique identifier of the user

  - `[:electric, :satellite, :replication, :transaction_receive]`

      Emitted when a transaction is received from Satellite by Electric.

      This event contains the following measurements:

      - `operations`: Number of the operations in this transaction
      - `inserts`: Number of inserts in this transaction
      - `updates`: Number of updates in this transaction
      - `deletes`: Number of deletes in this transaction

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `client_id`: Unique identifier of the client's device
      - `user_id`: Unique identifier of the user

  - `[:electric, :satellite, :replication, :bad_transaction]`

      Emitted when a transaction is received from Satellite by Electric, but
      the transaction contains malformed data and thus rejected, and the connection
      is about to be closed.

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `client_id`: Unique identifier of the client's device
      - `user_id`: Unique identifier of the user

  ### `[:electric, :satellite, :replication, :new_subscription, *]`

  Represents events related to shape subscription by the clients

  - `[:electric, :satellite, :replication, :new_subscription, :start]`

      Emitted when a new shape subscription is successfully requested by the client.
      Starts a span that ends when the initial data is successfully sent.


      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.
      - `included_tables`: Number of tables included in the shape
      - `shapes`: Number of shapes in this subscription

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this span
      - `parent_telemetry_span_context`: Unique identifier of the parent `:replication` span
      - `client_id`: Unique identifier of the client's device
      - `user_id`: Unique identifier of the user
      - `subscription_id`: Unique identifier of this subscription
      - `shape_hashes`: List of shape hashes in this subscription

  - `[:electric, :satellite, :replication, :new_subscription, :shape_data]`

      Emitted when initial data for the new subscription is received from PG.

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units
      - `duration`: Duration of queries to get initial data
      - `row_count`: Total number of rows that PG returned for this shape

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this shape span
      - `shape_hash`: Hash of the shape

  - `[:electric, :satellite, :replication, :new_subscription, :stop]`

      Emitted when initial data for the new subscription is sent to the client.

      This event contains the following measurements:

      - `monotonic_time`: The time of this event, in `:native` units.
      - `data_ready_monotonic_time`: Time of initial data readiness, in `:native` units.
      - `data_ready_duration`: Duration of initial data query
      - `send_lag`: Duration from receiving initial data to sending it to the client
      - `duration`: Total duration from receiving the subscription request to sending the data

      And the following metadata:

      - `telemetry_span_context`: Unique identifier for this shape span
      - `parent_telemetry_span_context`: Unique identifier of the parent `:replication` span
      - `client_id`: Unique identifier of the client's device
      - `user_id`: Unique identifier of the user
      - `subscription_id`: Unique identifier of this subscription
      - `shape_hashes`: List of shape hashes in this subscription
  """

  defstruct [
    :span_name,
    :telemetry_span_context,
    :start_time,
    :start_metadata,
    intermediate_measurements: %{}
  ]

  @type metadata :: :telemetry.event_metadata()
  @type measurements :: :telemetry.event_measurements()
  @type span_name :: atom() | [atom()]
  @type event_name :: atom()

  @type t :: %__MODULE__{
          span_name: span_name(),
          telemetry_span_context: reference(),
          start_time: integer(),
          start_metadata: metadata(),
          intermediate_measurements: measurements()
        }

  @app_name :electric

  def pg_producer_received(origin, type) when type in [:insert, :update, :delete] do
    :telemetry.execute([:electric, :postgres_logical, :received], %{total: 1}, %{
      type: type,
      origin: origin
    })
  end

  def pg_slot_replication_event(origin, data) when is_map(data) do
    :telemetry.execute([:electric, :postgres_slot, :replication], data, %{origin: origin})
  end

  def satellite_connection_event(data) when is_map(data) do
    :telemetry.execute([:electric, :satellite, :connection], data)
  end

  def satellite_replication_event(data) when is_map(data) do
    :telemetry.execute([:electric, :satellite, :replication], data)
  end

  @doc false
  @spec start_span(span_name(), measurements(), metadata()) :: t()
  def start_span(span_name, measurements, metadata) do
    measurements = Map.put_new_lazy(measurements, :monotonic_time, &System.monotonic_time/0)
    telemetry_span_context = make_ref()

    span = %__MODULE__{
      span_name: List.wrap(span_name),
      telemetry_span_context: telemetry_span_context,
      start_time: measurements[:monotonic_time],
      start_metadata: metadata
    }

    _ = untimed_span_event(span, :start, measurements, metadata)
    span
  end

  @doc false
  @spec start_child_span(t(), span_name(), measurements(), metadata()) :: t()
  def start_child_span(parent_span, span_name, measurements \\ %{}, metadata \\ %{}) do
    metadata =
      Map.put(metadata, :parent_telemetry_span_context, parent_span.telemetry_span_context)

    start_span(span_name, measurements, metadata)
  end

  @doc false
  @spec stop_span(t(), measurements(), metadata()) :: :ok
  def stop_span(span, measurements \\ %{}, metadata \\ %{}) do
    measurements = Map.put_new_lazy(measurements, :monotonic_time, &System.monotonic_time/0)

    measurements =
      Map.put(measurements, :duration, measurements[:monotonic_time] - span.start_time)

    metadata = Map.merge(span.start_metadata, metadata)

    untimed_span_event(span, :stop, measurements, metadata)
  end

  @doc false
  @spec span_event(t(), event_name(), measurements(), metadata()) :: :ok
  def span_event(span, name, measurements \\ %{}, metadata \\ %{}) do
    measurements = Map.put_new_lazy(measurements, :monotonic_time, &System.monotonic_time/0)
    untimed_span_event(span, name, measurements, metadata)
  end

  @doc false
  @spec untimed_span_event(t(), event_name(), measurements(), metadata()) :: :ok
  def untimed_span_event(span, name, measurements \\ %{}, metadata \\ %{})

  def untimed_span_event(nil, _, _, _), do: :ok

  def untimed_span_event(span, name, measurements, metadata) do
    metadata = Map.put(metadata, :telemetry_span_context, span.telemetry_span_context)
    event(span.span_name ++ [name], measurements, metadata)
  end

  @spec non_span_event(span_name(), measurements(), metadata()) :: :ok
  def non_span_event(name, measurements \\ %{}, metadata \\ %{}) do
    measurements = Map.put_new_lazy(measurements, :monotonic_time, &System.monotonic_time/0)
    event(List.wrap(name), measurements, metadata)
  end

  defp event(suffix, measurements, metadata) when is_list(suffix) do
    :telemetry.execute([@app_name | suffix], measurements, metadata)
  end
end
