defmodule Electric.Replication.Postgres.TcpServer do
  @moduledoc """
  Ranch protocol that speaks Postgres messaging. It supports a small subset of Postgres queries
  required to establish an perform logical replication.

  ## Supported commands

  This implementation is meant to act as a source for Postgres logical replication, and thus only supports
  only commands required for establishment and service of the subscription.

  Commands below are described in the order that the subscriber issues them, so it acts as a protocol reference as well.

  ### Common commands

  - `SELECT pg_catalog.set_config('search_path', '', false);`

    Is used by the client to set the search path. Executed on every connection.

  ### On subscription creation

  These commands are sent by the subscriber right after `CREATE SUBSCRIPTION` command was executed there.

  - `SELECT DISTINCT t.schemaname, t.tablename FROM pg_catalog.pg_publication_tables t WHERE t.pubname IN ($publication_name)`

    When creating the subscription, the follower requests all the tables within the target publication using the publication name.
    Electric should know which tables are replicated within this publication and respond accordingly. Right now we collect that
    information from the source on the connection creation and assume it to be valid throughout the system lifetime.
    If any of the tables are missing on the subscriber, it will fail.

  - `CREATE_REPLICATION_SLOT $slot_name LOGICAL pgoutput NOEXPORT_SNAPSHOT`

    Postgres uses so-called "slots" to track which changes from the write-ahead log has been sent to the client. When creating the
    subscription, the follower requests slot creation for itself (slot creation & naming
    [can be configured](https://www.postgresql.org/docs/current/sql-createsubscription.html) when running `CREATE SUBSCRIPTION` command).
    For our purposes that means we need to start tracking sent data under this name.

  ### On replication start

  - `IDENTIFY_SYSTEM`

    Before starting the replication, the client requests information about the system. It expects a server identifier, a current WAL position,
    and a timeline. Since the server identifier is an arbitrary string, we're currently using `to_string(node())` for that purpose. Timeline
    is always `"1"` - the recovery pattern it's meant for is irrelevant for Electric for now. WAL position is discussed separately in a later section.

  - `START_REPLICATION SLOT $slot_name LOGICAL $lsn (proto_version '2', publication_names '$publication_name')`

    Actual command used to start the replication. This puts the TCP connection in a special "copy" mode, where we expect only four kinds of TCP messages:
    - Keep-alive message from the server
    - Status message from the subscriber
    - Streamed WAL messages from the server
    - End of copy mode (replication stops upon that request) or termination

    Client expects the WAL messages to have monotonically growing WAL sequence numbers, which is tracked & managed by a separate Slot process.
    Upon client restart or subscription enablement, the $lsn is the one last processed by the client.

  ### After first replication start

  > #### Note!
  > This section is not supported yet, namely we don't support `COPY`,
  > `CREATE_REPLICATION_SLOT ... USE_SNAPSHOT` and `DROP_REPLICATION_SLOT` commands.
  > This is an explicit decision, because this part of the process can be turned off on the
  > subscriber, using `CREATE SUBSCRIPTION ... WITH (copy_data = false)` command.
  >
  > TODO: Support creation of a fake replication slot & sending a null response to the `COPY` command

  After replication connection has been established, the subscriber will do the initial synchronization. For that purpose, it will
  create a temporary replication slot with data snapshot usable only within the transaction, and then ask the server to stream all the data it has.
  Right now we don't support streaming historic data, but we nonetheless support the commands so that the client thinks that everything is fine.

  Subscriber will establish a connection per table in the publication and execute the following:

  - `BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ`

    Since replication slot with the `USE_SNAPSHOT` scope can only be created within a transaction, subscriber starts the readonly transaction for that.
    We accept the command, but it doesn't actually do anything.

  - `CREATE_REPLICATION_SLOT $slot_name LOGICAL pgoutput USE_SNAPSHOT`

    Subscriber creates a transient replication slot using the data currently available. It expects a "consistent point" WAL sequence number (LSN), which it uses
    later to start the replication from. Intention is to receive any data changed while the `COPY` operation will be executing.

  - `SELECT c.oid, c.relreplident, c.relkind FROM pg_catalog.pg_class c INNER JOIN pg_catalog.pg_namespace n ON (c.relnamespace = n.oid) WHERE n.nspname = $namespace AND c.relname = $table_name`

    Subscriber gets the OID of the table, its kind and its replica identity. We can generate that information from known tables and
    that we only support full replica identity for now

  - `SELECT a.attname, a.atttypid, a.attnum = ANY(i.indkey) FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_index i ON (i.indexrelid = pg_get_replica_identity_index($1)) WHERE a.attnum > 0::pg_catalog.int2 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attrelid = $1 ORDER BY a.attnum`

    Subscriber checks the column names, attribute types, and whether any of the columns are part of the replica identity. We should have this information anyway to
    properly construct the streamed WAL, so we can generate that data as well. `$1` in the above statement is the OID of the table received from the previous command

  - `COPY $namespace.$table_name TO STDOUT`

    Subscriber requests to copy out all the data currently in that table. We're sending an empty response for now.

  - `COMMIT`

    This finishes the transaction. As with `BEGIN ...`, this is a null operation from the POV of this server

  - `START_REPLICATION SLOT $slot_name LOGICAL $consistent_point_lsn (proto_version '2', publication_names '$publication_name')`

    To collect the changes made to the server while the `COPY` operation was in progress, the subscriber starts the created replication slot. Since the
    server is expect to immediately stream any changes that happened after the `$consistent_point_lsn`, the client sends one status report and then closes
    the copy mode as soon as server stops sending data.

  - `DROP_REPLICATION_SLOT $slot_name WAIT`

    After the initial copy has been complete, the client drops the created transient replication slot.
  """

  use GenServer
  @behaviour :ranch_protocol
  require Logger

  alias Electric.Postgres.Messaging
  alias Electric.Postgres.SchemaRegistry
  alias Electric.Postgres.OidDatabase
  alias Electric.Replication.Postgres.SlotServer
  alias Electric.Postgres.Lsn

  defmodule State do
    defstruct socket: nil,
              transport: nil,
              client: nil,
              settings: %{},
              accept_ssl: false,
              mode: :normal,
              slot: nil,
              slot_server: nil

    @type t() :: %__MODULE__{
            socket: :ranch_transport.socket(),
            transport: module(),
            client: String.t() | nil,
            settings: %{},
            accept_ssl: boolean(),
            mode: :normal | :copy,
            slot: SlotServer.slot_name() | nil,
            slot_server: SlotServer.slot_reg() | nil
          }
  end

  @impl :ranch_protocol
  def start_link(ref, transport, protocol_options) do
    GenServer.start_link(__MODULE__, {ref, transport, protocol_options})
  end

  @impl GenServer
  def init({ref, transport, _}) do
    {:ok, %State{transport: transport}, {:continue, {:handshake, ref}}}
  end

  @impl GenServer
  def handle_continue({:handshake, ref}, state) do
    # Accept socket from Ranch and try to talk Postgres with it
    {:ok, socket} = :ranch.handshake(ref)
    {:ok, {ip, port}} = :inet.peername(socket)
    client = "#{:inet.ntoa(ip)}:#{port}"
    Logger.metadata(pg_client: client)
    Logger.debug("Connection initialized by #{client}")

    {:noreply, %State{state | socket: socket, client: client}, {:continue, :establish_connection}}
  end

  def handle_continue(:establish_connection, state) do
    with {:ok, <<length::32>>} <- state.transport.recv(state.socket, 4, 100),
         {:ok, data} <- state.transport.recv(state.socket, length - 4, 100) do
      establish_connection(data, state)
    else
      {:error, :timeout} ->
        Logger.debug("Connection timeout")
        {:stop, :timeout, state}

      {:error, :closed} ->
        Logger.debug("Connection closed by client")
        state.transport.close(state.socket)
        {:stop, :normal, state}
    end
  end

  def handle_continue({:cancel, <<0::14, b::15, c::3>>, 0}, state) do
    # Pid serialization & cancellation works under the assumption that the Postgres will
    # always connect to the same node of Electric, so the process that's handling the
    # ongoing query must be on the same node
    pid = :c.pid(0, b, c)
    Logger.debug("Cancellation request issued for #{inspect(pid)}")
    send(pid, :cancel_operation)
    state.transport.close(state.socket)
    {:stop, :normal, state}
  end

  # TODO: maybe support SSL?
  def handle_continue(:upgrade_connection_to_ssl, %{accept_ssl: false} = state) do
    # Deny the upgrade request and continue establishing the connection
    tcp_send(Messaging.deny_upgrade_request(), state)
    Logger.debug("SSL upgrade denied")
    {:noreply, state, {:continue, :establish_connection}}
  end

  defp get_length_and_maybe_data(<<length::32, data::binary>>, _), do: {:ok, length, data}

  defp get_length_and_maybe_data(partial_length, state) do
    expected_size = 4 - byte_size(partial_length)

    with {:ok, rest_of_length} <- state.transport.recv(state.socket, expected_size, 100),
         <<length::32>> <- <<partial_length::binary, rest_of_length::binary>> do
      {:ok, length, <<>>}
    end
  end

  defp get_data_and_tail(length, data, _state) when byte_size(data) == length,
    do: {:ok, data, <<>>}

  defp get_data_and_tail(length, data, _state) when byte_size(data) > length,
    do: {:ok, binary_part(data, 0, length), binary_part(data, length, byte_size(data) - length)}

  defp get_data_and_tail(length, data, state) when byte_size(data) < length do
    with {:ok, rest_of_data} <- state.transport.recv(state.socket, length - byte_size(data), 100) do
      {:ok, data <> rest_of_data, <<>>}
    end
  end

  @impl true
  def handle_info({:tcp, socket, <<tag::8, contents::binary>>}, state) do
    with {:ok, length, data} <- get_length_and_maybe_data(contents, state),
         {:ok, data, tail} <- get_data_and_tail(length - 4, data, state),
         {:ok, new_state} <- handle_message(tag, data, state) do
      if tail != "" do
        # Beginning of the next message got into this TCP packet, handling the rest
        handle_info({:tcp, socket, tail}, new_state)
      else
        :ok = state.transport.setopts(socket, active: :once)
        {:noreply, new_state}
      end
    else
      {:stop, reason, new_state} ->
        state.transport.close(socket)
        {:stop, reason, new_state}

      {:error, reason} ->
        Logger.debug(
          "Error while handling a TCP message with tag #{inspect(<<tag::8>>)}: #{reason}"
        )

        state.transport.close(socket)
        reason = if reason == :closed, do: :normal, else: reason
        {:stop, reason, state}
    end
  end

  @impl true
  def handle_info(:cancel_operation, state) do
    Messaging.error(:fatal, code: "57014", message: "Query has been cancelled by the client")
    |> Messaging.ready()
    |> tcp_send(state)

    {:noreply, state}
  end

  @impl true
  def handle_info(_, state) do
    state.transport.close(state.socket)
    Logger.debug("Socket closed by client #{inspect(state.client)}")
    {:stop, :shutdown, state}
  end

  @spec handle_message(tag :: char(), body :: binary(), state :: State.t()) ::
          {:ok, State.t()} | {:stop, atom(), State.t()}
  defp handle_message(?X, "", state) do
    # Session termination command
    Logger.debug("Session terminated by the client")
    {:stop, :normal, state}
  end

  defp handle_message(?Q, data, state) do
    data
    |> String.trim_trailing(<<0>>)
    |> String.trim_trailing(";")
    |> collapse_unquoted_spaces()
    |> tap(&Logger.debug("Query received: #{inspect(&1)}"))
    |> String.split(" ", parts: 2, trim: true)
    |> handle_query(state)
    |> case do
      message when is_binary(message) ->
        tcp_send(message, state)
        {:ok, state}

      {message, new_state} ->
        tcp_send(message, new_state)
        {:ok, new_state}
    end
  end

  defp handle_message(?c, "", %{mode: :copy} = state) do
    # End copy mode

    SlotServer.stop_replication(state.slot_server)

    Messaging.end_copy_mode()
    |> Messaging.command_complete("COPY 0")
    |> Messaging.command_complete("START_REPLICATION")
    |> Messaging.ready()
    |> tcp_send(state)

    {:ok, %{state | mode: :normal, slot: nil}}
  end

  defp handle_message(?d, <<?r, data::binary>>, %State{mode: :copy} = state) do
    # Copy mode client status report
    # TODO: Maybe pass this info on to the SlotServer? We don't really do any thing with it right now
    <<_written_wal::64, _flushed_wal::64, _applied_wal::64, _client_timestamp::64,
      immediate_response::8>> = data

    if immediate_response == 1 do
      SlotServer.send_keepalive(state.slot_server)
    end

    {:ok, state}
  end

  defp handle_message(tag, data, state) do
    Logger.warn(
      "Received unexpected message in mode #{state.mode} (tag #{inspect(<<tag::8>>)}): #{inspect(data)}"
    )

    Messaging.error(:fatal,
      code: "08P01",
      message: "Unexpected message during connection"
    )
    |> tcp_send(state)

    {:stop, :normal, state}
  end

  defp establish_connection(<<1234::16, 5679::16>>, state) do
    # SSL connection request
    Logger.debug("SSL upgrade requested by the client")
    {:noreply, state, {:continue, :upgrade_connection_to_ssl}}
  end

  defp establish_connection(<<1234::16, 5678::16, pid::binary-4, secret::32>>, state) do
    # Cancellation request
    {:noreply, state, {:continue, {:cancel, pid, secret}}}
  end

  defp establish_connection(<<1234::16, 5680::16>>, state) do
    # GSSAPI encrypted connection request
    # Deny the request and continue establishing the connection
    tcp_send(Messaging.deny_upgrade_request(), state)
    Logger.debug("GSSAPI encrypted connection upgrade denied")
    {:noreply, state, {:continue, :establish_connection}}
  end

  defp establish_connection(<<3::16, 0::16, data::binary>>, state) do
    settings = parse_client_startup_settings(data)

    if authentication_required?(state.client, settings) do
      # TODO: `handle_continue` for authentication is not implemented
      Logger.debug("Authentication required for the client")
      {:noreply, %{state | settings: settings}, {:continue, :request_authentication}}
    else
      initialize_connection(state, settings)
    end
  end

  defp establish_connection(data, state) do
    Logger.warning("Unexpected data from the client during initialization: #{inspect(data)}")

    Messaging.error(:fatal,
      code: "08P01",
      message: "Unexpected message during connection establishment"
    )
    |> tcp_send(state)

    state.transport.close(state.socket)
    {:stop, :normal, :state}
  end

  defp initialize_connection(%State{} = state, %{"replication" => "database"} = settings) do
    if SchemaRegistry.is_origin_ready?(settings["application_name"]) do
      # TODO: Verify the server settings, maybe make them dynamic?
      Messaging.authentication_ok()
      |> Messaging.parameter_status("application_name", settings["application_name"])
      |> Messaging.parameter_status("client_encoding", settings["client_encoding"])
      |> Messaging.parameter_status("server_encoding", "UTF8")
      |> Messaging.parameter_status("server_version", "electric-0.0.1")
      |> Messaging.parameter_status("standard_conforming_strings", "on")
      |> Messaging.parameter_status("TimeZone", "Etc/UTC")
      |> Messaging.backend_key_data(serialize_pid(self()), 0)
      |> Messaging.ready()
      |> tcp_send(state)

      Logger.metadata(pg_client: state.client, origin: settings["application_name"])

      Logger.debug(
        "Connection established with #{inspect(state.client)}, client config: #{inspect(settings, pretty: true)}"
      )

      :ok = state.transport.setopts(state.socket, active: :once)
      {:noreply, %State{state | settings: settings}}
    else
      Messaging.error(:fatal,
        code: "08004",
        message:
          "Electric replication is not ready, missing schema for #{settings["application_name"]}"
      )
      |> tcp_send(state)

      Logger.debug(
        "Denied connection for client #{settings["application_name"]}, schema not ready"
      )

      state.transport.close(state.socket)
      {:stop, :normal, state}
    end
  end

  defp initialize_connection(%State{} = state, _settings) do
    Messaging.error(:fatal,
      code: "08004",
      message: "Electric mesh allows connection only in `replication=database` mode"
    )
    |> tcp_send(state)

    state.transport.close(state.socket)
    {:stop, :normal, state}
  end

  defp handle_query(["SELECT", "pg_catalog.set_config('search_path', '', false)"], _) do
    # Query to reset the search path, noop for us
    Messaging.row_description(set_config: [type: :text])
    |> Messaging.data_row([""])
    |> Messaging.command_complete("SELECT 1")
    |> Messaging.ready()
  end

  defp handle_query(
         [
           "SELECT",
           "DISTINCT t.schemaname, t.tablename FROM pg_catalog.pg_publication_tables t WHERE t.pubname IN " <>
             publications_list
         ],
         _
       ) do
    # Listing all tables in the publication, as set in the schema registry
    with [pub] <- Regex.run(~r/\(\'(?<pub>[\w\_]+)\'\)/, publications_list, capture: ["pub"]),
         {:ok, tables} <- SchemaRegistry.fetch_replicated_tables(pub) do
      Messaging.row_description(schemaname: :name, tablename: :name)
      |> Messaging.data_rows(Enum.map(tables, &{&1.schema, &1.name}))
      |> Messaging.command_complete("SELECT #{length(tables)}")
      |> Messaging.ready()
    end
  end

  defp handle_query(
         [
           "SELECT",
           "c.oid, c.relreplident, c.relkind FROM pg_catalog.pg_class c INNER JOIN pg_catalog.pg_namespace n ON (c.relnamespace = n.oid) WHERE " <>
             where
         ],
         _
       ) do
    # Getting the information about a particular table
    [schema, table] =
      Regex.run(~r/n\.nspname = '([^']+)' AND c\.relname = '([^']+)'/, where,
        capture: :all_but_first
      )

    {:ok, table} = SchemaRegistry.fetch_table_info({schema, table})

    Messaging.row_description(oid: :oid, relreplident: :char, relkind: :char)
    |> Messaging.data_row({to_string(table.oid), atom_to_identity(table.replica_identity), "f"})
    |> Messaging.command_complete("SELECT 1")
    |> Messaging.ready()
  end

  # Query is truncated here as it's too long. Full version is available in the module documentation.
  # This does match other queries, but we don't expect them to be actually ran against this server.
  defp handle_query(
         [
           "SELECT",
           "a.attname, a.atttypid, a.attnum = ANY(i.indkey) FROM pg_catalog.pg_attribute a" <>
             rest
         ],
         _
       ) do
    # Getting information about the columns within a table
    [target_oid] = Regex.run(~r/a\.attrelid = (\d+)/, rest, capture: :all_but_first)
    {:ok, columns} = SchemaRegistry.fetch_table_columns(String.to_integer(target_oid))

    Messaging.row_description(attname: :name, atttypid: :oid, "?column?": :bool)
    |> Messaging.data_rows(
      Enum.map(columns, &{&1.name, OidDatabase.oid_for_name(&1.type), &1.part_of_identity?})
    )
    |> Messaging.command_complete("SELECT #{length(columns)}")
    |> Messaging.ready()
  end

  defp handle_query(["IDENTIFY_SYSTEM"], state) do
    # Getting system information
    # TODO: we're sending over `0/1` lsn as a consistent point of the system since that's
    #       what the slot are going to be started from. Is that going to be an issue when
    #       the client reconnects?
    Messaging.row_description(
      systemid: [type: :text],
      timeline: [type: :int4],
      xlogpos: [type: :text],
      dbname: [type: :text]
    )
    |> Messaging.data_row([
      to_string(node(self())),
      1,
      "0/1",
      state.settings["database"]
    ])
    |> Messaging.command_complete("IDENTIFY_SYSTEM")
    |> Messaging.ready()
  end

  defp handle_query(["BEGIN", _], _) do
    # No-op since we don't expect to actual transactions
    Messaging.command_complete("BEGIN")
    |> Messaging.ready()
  end

  defp handle_query(["COMMIT"], _) do
    # No-op since we don't expect to actual transactions
    Messaging.command_complete("COMMIT")
    |> Messaging.ready()
  end

  # no op
  defp handle_query(["DROP_REPLICATION_SLOT" | _args], _) do
    Messaging.command_complete("DROP_REPLICATION_SLOT")
    |> Messaging.ready()
  end

  defp handle_query(["START_REPLICATION", args], state) do
    ["SLOT", slot_name, "LOGICAL", lsn_string | options] =
      String.split(args, " ", trim: true, parts: 5)

    slot_name = String.trim(slot_name, ~s|"|)
    slot_server = SlotServer.get_slot_reg(slot_name)
    target_lsn = Lsn.from_string(lsn_string)

    options = parse_replication_options(options)
    publication = String.trim(options["publication_names"], ~s|"|)

    Logger.debug(
      "Starting replication mode for slot #{slot_name} (publication '#{publication}') starting from #{target_lsn}"
    )

    Messaging.start_copy_mode()
    |> tcp_send(state)

    # FIXME: we should handle scenario when slot server is down at this moment
    SlotServer.start_replication(slot_server, &tcp_send(&1, state), publication, target_lsn)

    {nil, %{state | mode: :copy, slot: slot_name, slot_server: slot_server}}
  end

  defp handle_query(["CREATE_REPLICATION_SLOT", _args], _state) do
    Messaging.error(:error,
      code: "0A000",
      message: "Electric replication does not support snapshot exporting"
    )
    |> Messaging.ready()
  end

  # TODO: implement actual logic for authentication requirement
  defp authentication_required?("127.0.0.1" <> _, _settings), do: false
  defp authentication_required?(_, _settings), do: false

  defp tcp_send(nil, _), do: :ok

  defp tcp_send(data, %State{transport: transport, socket: socket}) when is_binary(data) do
    transport.send(socket, data)
  end

  defp parse_client_startup_settings(data) when is_binary(data) do
    data
    |> String.split(<<0>>, trim: true)
    |> Enum.chunk_every(2)
    |> Map.new(&List.to_tuple/1)
  end

  defp serialize_pid(pid) do
    [_, b, c] =
      pid
      |> :erlang.pid_to_list()
      |> to_string
      |> String.split([">", "<", "."], trim: true)
      |> Enum.map(&String.to_integer/1)

    <<0::14, b::15, c::3>>
  end

  defp parse_replication_options([]), do: []

  defp parse_replication_options([opts]) do
    opts
    |> String.slice(1..-2//1)
    |> String.split(", ", trim: true)
    |> Enum.map(&Regex.run(~r/([\w_\d]+) '((?:[^'\\]|\\.)*)'/, &1, capture: :all_but_first))
    |> Map.new(&List.to_tuple/1)
  end

  defp atom_to_identity(:all_columns), do: "f"
  defp atom_to_identity(:default), do: "d"
  defp atom_to_identity(:nothing), do: "n"
  defp atom_to_identity(:index), do: "i"

  defp collapse_unquoted_spaces(string) do
    # Matches either a single-quoted string (with escapes), double-quoted string (with escapes),
    # or a sequence of spaces & line breaks which wasn't matched by previous cases, and then
    # replaces only the space sequence
    Regex.replace(~r/'(?:[^'\\]|\\.)+'|"(?:[^"\\]|\\.)+"|(?<space>[\s\n]+)/, string, fn
      match, "" -> match
      _, _ -> " "
    end)
  end
end
