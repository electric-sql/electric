# Derived from Postgrex.ReplicationConnection
# https://github.com/elixir-ecto/postgrex
#
# Copyright 2013 Eric Meadows-Jönsson and contributors
# Licensed under the Apache License, Version 2.0
# (https://www.apache.org/licenses/LICENSE-2.0)
#
# Modifications by Electric DB Ltd:
#   - Added socket pause/resume for backpressure (paused, buffered_copies,
#     buffered_sock_msg, noreply_and_pause/noreply_and_resume return types).

defmodule Electric.Postgres.ReplicationConnection do
  @moduledoc """
  Vendored and extended version of `Postgrex.ReplicationConnection`.

  Adds socket pause/resume support so that the callback module can apply
  backpressure (stop reading WAL data) while remaining responsive to
  non-socket messages such as keepalive timers.

  ## Extensions over upstream

  Two new return types are available from `handle_data/2` and `handle_info/2`:

    * `{:noreply_and_pause, ack, state}` — send any ack messages to PostgreSQL,
      then pause socket reads. The gen_statem will still process `handle_info`
      and `handle_call` messages (e.g. keepalive timers), but no further
      `handle_data` callbacks will fire until the socket is resumed.

    * `{:noreply_and_resume, ack, state}` — send ack messages, resume socket
      reads, and process any buffered data that arrived while paused.

  When paused, TCP/SSL data that arrives on the socket is buffered (at most
  one Erlang message, since the socket uses `{active, :once}`). This provides
  natural TCP-level backpressure: once the kernel receive buffer fills,
  PostgreSQL's walsender blocks on write.

  The callback module is expected to send periodic `StandbyStatusUpdate`
  messages via `{:noreply, [encoded_msg], state}` from a `handle_info`
  timer callback to prevent PostgreSQL's `wal_sender_timeout` from firing.
  """

  require Logger
  import Bitwise

  alias Postgrex.Protocol

  @behaviour :gen_statem

  @doc false
  defstruct protocol: nil,
            state: nil,
            auto_reconnect: false,
            reconnect_backoff: 500,
            streaming: nil,
            # Pause/resume extensions
            paused: false,
            buffered_copies: [],
            buffered_sock_msg: nil

  ## PUBLIC API ##

  @type server :: :gen_statem.server_ref()
  @type state :: term
  @type ack :: iodata
  @type query :: iodata
  @type reason :: String.t()
  @type stream_opts :: [max_messages: pos_integer]

  @query_timeout :infinity
  @type query_opts :: [timeout: timeout]

  @max_lsn_component_size 8
  @max_uint64 18_446_744_073_709_551_615
  @max_messages 500

  @callback init(term) :: {:ok, state}

  @callback handle_connect(state) ::
              {:noreply, state}
              | {:noreply, ack, state}
              | {:query, query, state}
              | {:query, query, query_opts, state}
              | {:stream, query, stream_opts, state}
              | {:disconnect, reason}

  @callback handle_disconnect(state) :: {:noreply, state}

  @callback handle_data(binary | :done, state) ::
              {:noreply, state}
              | {:noreply, ack, state}
              | {:noreply_and_pause, ack, state}
              | {:query, query, state}
              | {:query, query, query_opts, state}
              | {:stream, query, stream_opts, state}
              | {:disconnect, reason}

  @callback handle_info(term, state) ::
              {:noreply, state}
              | {:noreply, ack, state}
              | {:noreply_and_resume, ack, state}
              | {:query, query, state}
              | {:query, query, query_opts, state}
              | {:stream, query, stream_opts, state}
              | {:disconnect, reason}

  @callback handle_call(term, :gen_statem.from(), state) ::
              {:noreply, state}
              | {:noreply, ack, state}
              | {:query, query, state}
              | {:query, query, query_opts, state}
              | {:stream, query, stream_opts, state}
              | {:disconnect, reason}

  @callback handle_result([Postgrex.Result.t()] | Postgrex.Error.t(), state) ::
              {:noreply, state}
              | {:noreply, ack, state}
              | {:query, query, state}
              | {:query, query, query_opts, state}
              | {:stream, query, stream_opts, state}
              | {:disconnect, reason}

  @optional_callbacks handle_call: 3,
                      handle_connect: 1,
                      handle_data: 2,
                      handle_disconnect: 1,
                      handle_info: 2,
                      handle_result: 2

  defdelegate reply(client, reply), to: :gen_statem

  def call(server, message, timeout \\ 5000) do
    with {__MODULE__, reason} <- :gen_statem.call(server, message, timeout) do
      exit({reason, {__MODULE__, :call, [server, message, timeout]}})
    end
  end

  @doc false
  defmacro __using__(opts) do
    quote location: :keep, bind_quoted: [opts: opts] do
      @behaviour Electric.Postgres.ReplicationConnection

      unless Module.has_attribute?(__MODULE__, :doc) do
        @doc """
        Returns a specification to start this module under a supervisor.

        See `Supervisor`.
        """
      end

      def child_spec(init_arg) do
        default = %{
          id: __MODULE__,
          start: {__MODULE__, :start_link, [init_arg]}
        }

        Supervisor.child_spec(default, unquote(Macro.escape(opts)))
      end

      defoverridable child_spec: 1
    end
  end

  @spec start_link(module(), term(), Keyword.t()) ::
          {:ok, pid} | {:error, Postgrex.Error.t() | term}
  def start_link(module, arg, opts) do
    {name, opts} = Keyword.pop(opts, :name)
    opts = Keyword.put_new(opts, :sync_connect, true)
    connection_opts = Postgrex.Utils.default_opts(opts)
    start_args = {module, arg, connection_opts}

    case name do
      nil ->
        :gen_statem.start_link(__MODULE__, start_args, [])

      atom when is_atom(atom) ->
        :gen_statem.start_link({:local, atom}, __MODULE__, start_args, [])

      {:global, _term} = tuple ->
        :gen_statem.start_link(tuple, __MODULE__, start_args, [])

      {:via, via_module, _term} = tuple when is_atom(via_module) ->
        :gen_statem.start_link(tuple, __MODULE__, start_args, [])

      other ->
        raise ArgumentError, """
        expected :name option to be one of the following:
          * nil
          * atom
          * {:global, term}
          * {:via, module, term}
        Got: #{inspect(other)}
        """
    end
  end

  @spec encode_lsn(integer) :: {:ok, String.t()} | :error
  def encode_lsn(lsn) when is_integer(lsn) do
    if 0 <= lsn and lsn <= @max_uint64 do
      <<file_id::32, offset::32>> = <<lsn::64>>
      {:ok, Integer.to_string(file_id, 16) <> "/" <> Integer.to_string(offset, 16)}
    else
      :error
    end
  end

  @spec decode_lsn(String.t()) :: {:ok, integer} | :error
  def decode_lsn(lsn) when is_binary(lsn) do
    with [file_id, offset] <- :binary.split(lsn, "/"),
         true <- byte_size(file_id) <= @max_lsn_component_size,
         true <- byte_size(offset) <= @max_lsn_component_size,
         {file_id, ""} when file_id >= 0 <- Integer.parse(file_id, 16),
         {offset, ""} when offset >= 0 <- Integer.parse(offset, 16) do
      {:ok, file_id <<< 32 ||| offset}
    else
      _ -> :error
    end
  end

  # Guard for matching socket messages from either :gen_tcp or :ssl.
  defguardp is_socket_msg(msg)
            when is_tuple(msg) and
                   elem(msg, 0) in [:tcp, :tcp_closed, :tcp_error, :ssl, :ssl_closed, :ssl_error]

  ## CALLBACKS ##

  @state :no_state

  @doc false
  @impl :gen_statem
  def callback_mode, do: :handle_event_function

  @doc false
  @impl :gen_statem
  def init({mod, arg, opts}) do
    case mod.init(arg) do
      {:ok, mod_state} ->
        opts =
          Keyword.update(
            opts,
            :parameters,
            [replication: "database"],
            &Keyword.put_new(&1, :replication, "database")
          )

        {auto_reconnect, opts} = Keyword.pop(opts, :auto_reconnect, false)
        {reconnect_backoff, opts} = Keyword.pop(opts, :reconnect_backoff, 500)

        state = %__MODULE__{
          auto_reconnect: auto_reconnect,
          reconnect_backoff: reconnect_backoff,
          state: {mod, mod_state}
        }

        put_opts(opts)

        if opts[:sync_connect] do
          case handle_event(:internal, {:connect, :init}, @state, state) do
            {:keep_state, state} -> {:ok, @state, state}
            {:keep_state, state, actions} -> {:ok, @state, state, actions}
            {:stop, reason, _state} -> {:stop, reason}
          end
        else
          {:ok, @state, state, {:next_event, :internal, {:connect, :init}}}
        end
    end
  end

  @doc false
  @impl :gen_statem
  def handle_event(type, content, state, s)

  def handle_event({:timeout, :backoff}, nil, @state, s) do
    {:keep_state, s, {:next_event, :internal, {:connect, :backoff}}}
  end

  def handle_event(:internal, {:connect, :reconnect}, @state, %{protocol: protocol} = state)
      when protocol != nil do
    Protocol.disconnect(:reconnect, protocol)
    {:keep_state, %{state | protocol: nil}, {:next_event, :internal, {:connect, :init}}}
  end

  def handle_event(:internal, {:connect, _info}, @state, %{state: {mod, mod_state}} = s) do
    case Protocol.connect(opts()) do
      {:ok, protocol} ->
        maybe_handle(mod, :handle_connect, [mod_state], %{s | protocol: protocol})

      {:error, reason} ->
        Logger.error(
          "#{inspect(pid_or_name())} (#{inspect(mod)}) failed to connect to Postgres: #{Exception.format(:error, reason)}"
        )

        if s.auto_reconnect do
          {:keep_state, s, {{:timeout, :backoff}, s.reconnect_backoff, nil}}
        else
          {:stop, reason, s}
        end
    end
  end

  def handle_event({:call, from}, msg, @state, %{state: {mod, mod_state}} = s) do
    handle(mod, :handle_call, [msg, from, mod_state], from, s)
  end

  # When paused, buffer socket messages instead of processing them.
  def handle_event(:info, msg, @state, %{paused: true, buffered_sock_msg: nil} = s)
      when is_socket_msg(msg) do
    {:keep_state, %{s | buffered_sock_msg: msg}}
  end

  # Second socket message while paused — shouldn't happen with {active, :once}
  # but handle gracefully by replacing (the protocol hasn't re-armed the socket).
  def handle_event(:info, _msg, @state, %{paused: true} = s) when false do
    # This clause is unreachable with {active, :once} but kept as documentation.
    {:keep_state, s}
  end

  # Normal (unpaused) socket message processing.
  def handle_event(:info, msg, @state, %{protocol: protocol, streaming: streaming} = s) do
    case Protocol.handle_copy_recv(msg, streaming, protocol) do
      {:ok, copies, protocol} ->
        handle_data(copies, %{s | protocol: protocol})

      :unknown ->
        %{state: {mod, mod_state}} = s
        maybe_handle(mod, :handle_info, [msg, mod_state], s)

      {error, reason, protocol} ->
        reconnect_or_stop(error, reason, protocol, s)
    end
  end

  ## Helpers

  defp handle_data([], s), do: {:keep_state, s}

  defp handle_data([:copy_done | copies], %{state: {mod, mod_state}} = s) do
    with {:keep_state, s} <-
           handle(mod, :handle_data, [:done, mod_state], nil, %{s | streaming: nil}) do
      handle_data(copies, s)
    end
  end

  defp handle_data([copy | copies], %{state: {mod, mod_state}} = s) do
    case handle(mod, :handle_data, [copy, mod_state], nil, s) do
      {:keep_state, s} ->
        handle_data(copies, s)

      {:keep_state_and_pause, s} ->
        # Callback requested pause — store remaining copies and stop processing.
        {:keep_state, %{s | paused: true, buffered_copies: copies}}

      other ->
        other
    end
  end

  defp maybe_handle(mod, fun, args, s) do
    if function_exported?(mod, fun, length(args)) do
      handle(mod, fun, args, nil, s)
    else
      {:keep_state, s}
    end
  end

  defp handle(mod, fun, args, from, %{streaming: streaming} = s) do
    case apply(mod, fun, args) do
      {:noreply, mod_state} ->
        {:keep_state, %{s | state: {mod, mod_state}}}

      {:noreply, replies, mod_state} ->
        s = %{s | state: {mod, mod_state}}

        case Protocol.handle_copy_send(replies, s.protocol) do
          :ok -> {:keep_state, s}
          {error, reason, protocol} -> reconnect_or_stop(error, reason, protocol, s)
        end

      {:noreply_and_pause, replies, mod_state} ->
        s = %{s | state: {mod, mod_state}}

        case Protocol.handle_copy_send(replies, s.protocol) do
          :ok -> {:keep_state_and_pause, s}
          {error, reason, protocol} -> reconnect_or_stop(error, reason, protocol, s)
        end

      {:noreply_and_resume, replies, mod_state} ->
        s = %{s | state: {mod, mod_state}, paused: false}

        case Protocol.handle_copy_send(replies, s.protocol) do
          :ok ->
            resume(s)

          {error, reason, protocol} ->
            reconnect_or_stop(error, reason, protocol, s)
        end

      {:stream, query, opts, mod_state} when streaming == nil ->
        s = %{s | state: {mod, mod_state}}
        max_messages = opts[:max_messages] || @max_messages

        with {:ok, protocol} <- Protocol.handle_streaming(query, s.protocol),
             {:ok, protocol} <- Protocol.checkin(protocol) do
          {:keep_state, %{s | protocol: protocol, streaming: max_messages}}
        else
          {error_or_disconnect, reason, protocol} ->
            reconnect_or_stop(error_or_disconnect, reason, protocol, s)
        end

      {:stream, _query, _opts, mod_state} ->
        stream_in_progress(:stream, mod, mod_state, from, s)

      {:query, query, mod_state} when streaming == nil ->
        handle_query(query, mod, from, s, mod_state, timeout: @query_timeout)

      {:query, query, opts, mod_state} when streaming == nil ->
        handle_query(query, mod, from, s, mod_state, opts)

      {:query, _query, mod_state} ->
        stream_in_progress(:query, mod, mod_state, from, s)

      {:query, _query, _opts, mod_state} ->
        stream_in_progress(:query, mod, mod_state, from, s)

      {:disconnect, reason} ->
        reconnect_or_stop(:disconnect, reason, s.protocol, s)
    end
  end

  # Process buffered copies and then any buffered socket message.
  defp resume(%{buffered_copies: copies, buffered_sock_msg: sock_msg} = s) do
    s = %{s | buffered_copies: [], buffered_sock_msg: nil}

    case handle_data(copies, s) do
      {:keep_state, s} when sock_msg != nil ->
        # Re-inject the buffered socket message for normal processing.
        send(self(), sock_msg)
        {:keep_state, s}

      {:keep_state_and_pause, s} ->
        # Callback paused again while processing remaining copies.
        # Re-attach the socket message for when we resume next time.
        {:keep_state, %{s | buffered_sock_msg: sock_msg}}

      other ->
        other
    end
  end

  defp handle_query(query, mod, from, s, mod_state, opts) do
    case Protocol.handle_simple(query, opts, s.protocol) do
      {:ok, results, protocol} when is_list(results) ->
        handle(mod, :handle_result, [results, mod_state], from, %{s | protocol: protocol})

      {:error, %Postgrex.Error{} = error, protocol} ->
        handle(mod, :handle_result, [error, mod_state], from, %{s | protocol: protocol})

      {:disconnect, reason, protocol} ->
        reconnect_or_stop(:disconnect, reason, protocol, %{s | state: {mod, mod_state}})
    end
  end

  defp stream_in_progress(command, mod, mod_state, from, s) do
    Logger.warning("received #{command} while stream is already in progress")
    from && reply(from, {__MODULE__, :stream_in_progress})
    {:keep_state, %{s | state: {mod, mod_state}}}
  end

  defp reconnect_or_stop(error, reason, protocol, %{auto_reconnect: false} = s)
       when error in [:error, :disconnect] do
    %{state: {mod, mod_state}} = s

    {:keep_state, s} =
      maybe_handle(mod, :handle_disconnect, [mod_state], %{s | protocol: protocol})

    {:stop, reason, s}
  end

  defp reconnect_or_stop(error, reason, _protocol, %{auto_reconnect: true} = s)
       when error in [:error, :disconnect] do
    %{state: {mod, mod_state}} = s

    Logger.error(
      "#{inspect(pid_or_name())} (#{inspect(mod)}) is reconnecting due to reason: #{Exception.format(:error, reason)}"
    )

    {:keep_state, s} = maybe_handle(mod, :handle_disconnect, [mod_state], s)

    {:keep_state, %{s | streaming: nil, paused: false, buffered_copies: [], buffered_sock_msg: nil},
     {:next_event, :internal, {:connect, :reconnect}}}
  end

  defp pid_or_name do
    case Process.info(self(), :registered_name) do
      {:registered_name, atom} when is_atom(atom) -> atom
      _ -> self()
    end
  end

  defp opts(), do: Process.get(__MODULE__)
  defp put_opts(opts), do: Process.put(__MODULE__, opts)

end
