defmodule Electric.Shapes.Api do
  alias Electric.Postgres.Inspector
  alias Electric.Replication.LogOffset
  alias Electric.Shapes
  alias Electric.DbConnectionError
  alias Electric.SnapshotError
  alias Electric.Telemetry.OpenTelemetry

  alias __MODULE__
  alias __MODULE__.Request
  alias __MODULE__.Response
  alias __MODULE__.SseState

  import Electric.Replication.LogOffset, only: [is_log_offset_lt: 2]

  require Logger

  @options [
    stack_id: [type: :string, required: true],
    inspector: [type: :mod_arg, required: true],
    allow_shape_deletion: [type: :boolean],
    feature_flags: [type: {:list, :string}, default: []],
    keepalive_interval: [type: :integer],
    long_poll_timeout: [type: :integer],
    sse_timeout: [type: :integer],
    max_age: [type: :integer],
    stack_ready_timeout: [type: :integer],
    stale_age: [type: :integer],
    send_cache_headers?: [type: :boolean],
    encoder: [type: :atom],
    max_concurrent_requests: [
      type: :map,
      keys: [
        initial: [type: :integer, required: true],
        existing: [type: :integer, required: true]
      ]
    ]
  ]
  @schema NimbleOptions.new!(@options)
  @option_keys Keyword.keys(@options) |> MapSet.new()

  defguardp is_configured(api) when api.configured

  defguardp is_out_of_bounds(request)
            when LogOffset.is_log_offset_lt(request.last_offset, request.params.offset)

  defstruct [
    :inspector,
    :shape,
    :stack_id,
    :feature_flags,
    :max_concurrent_requests,
    allow_shape_deletion: false,
    keepalive_interval: 21_000,
    long_poll_timeout: 20_000,
    sse_timeout: 60_000,
    max_age: 60,
    stack_ready_timeout: 5_000,
    stale_age: 300,
    send_cache_headers?: true,
    encoder: Electric.Shapes.Api.Encoder.JSON,
    sse_encoder: Electric.Shapes.Api.Encoder.SSE,
    configured: false
  ]

  @type t() :: %__MODULE__{}
  @type options() :: [unquote(NimbleOptions.option_typespec(@schema))]

  # Aliasing for pattern matching
  @before_all_offset LogOffset.before_all()
  @offset_out_of_bounds %{offset: ["out of bounds for this shape"]}

  # Need to implement Access behaviour because we use that to extract config
  # when using shapes api
  @behaviour Access

  @doc false
  def implements_persistent_kv({m, f, a}) do
    # wrap the args in a list because they're a keyword list, not an arg list
    implements_persistent_kv(apply(m, f, [a]))
  end

  def implements_persistent_kv(%_{} = struct) do
    case Electric.PersistentKV.impl_for(struct) do
      nil -> {:error, "#{inspect(struct)} does not implement the Electric.PersistentKV protocol"}
      _ -> {:ok, struct}
    end
  end

  @doc false
  def options_schema do
    @schema
  end

  def configure!(opts) do
    {api, _unused_opts} = configure(opts)
    api
  end

  def configure(opts) do
    {valid, extra} = Keyword.split_with(opts, fn {k, _} -> MapSet.member?(@option_keys, k) end)

    options = NimbleOptions.validate!(valid, @schema)

    api = %__MODULE__{configured: true} |> struct(options) |> validate_encoder!()

    {api, extra}
  end

  def plug_opts(opts) do
    {api, config} = configure(opts)

    config
    |> Keyword.put(:api, api)
    |> Keyword.put(:stack_id, api.stack_id)
  end

  defp validate_encoder!(%Api{} = api) do
    Map.update!(api, :encoder, &Shapes.Api.Encoder.validate!/1)
  end

  shape_schema_options =
    Keyword.merge(Keyword.drop(Shapes.Shape.schema_options(), [:inspector]),
      table: [type: :string],
      schema: [type: :string],
      namespace: [type: :string]
    )

  shape_schema = NimbleOptions.new!(shape_schema_options)

  @type shape_opts() :: [unquote(NimbleOptions.option_typespec(shape_schema))]

  @doc """
  Create a version of the given configured Api instance that is specific to the
  given shape.

  This allows you to provide a locked-down version of the API that ignores
  shape-definition parameters such as `table`, `where` and `columns` and only
  honours the shape-tailing parameters such as `offset` and `handle`.
  """
  @spec predefined_shape(t(), shape_opts()) :: {:ok, t()} | {:error, term()}
  def predefined_shape(%Api{} = api, shape_params) do
    with :ok <- hold_until_stack_ready(api),
         {:ok, params} <- normalise_shape_params(shape_params),
         opts = Keyword.merge(params, inspector: api.inspector, feature_flags: api.feature_flags),
         {:ok, shape} <- Shapes.Shape.new(opts) do
      {:ok, %{api | shape: shape}}
    end
  end

  defp normalise_shape_params(params) do
    case Keyword.fetch(params, :relation) do
      {:ok, {n, t}} when is_binary(n) and is_binary(t) ->
        {:ok, params}

      :error ->
        {table_params, shape_params} = Keyword.split(params, [:table, :namespace, :schema])

        case {table_params[:table], table_params[:namespace] || table_params[:schema]} do
          {nil, nil} ->
            {:error, "No relation or table specified"}

          {table, nil} when is_binary(table) ->
            {:ok, Keyword.put(shape_params, :relation, {"public", table})}

          {table, namespace} ->
            {:ok, Keyword.put(shape_params, :relation, {namespace, table})}
        end
    end
  end

  @doc """
  Validate the parameters for the request.
  """
  @spec validate(t(), %{(atom() | binary()) => term()}) ::
          {:ok, Request.t()} | {:error, Response.t()}
  def validate(%Api{} = api, params) when is_configured(api) do
    with :ok <- hold_until_stack_ready(api),
         {:ok, request} <- validate_params(api, params),
         {:ok, request} <- load_shape_info(request) do
      {:ok, seek(request)}
    end
  end

  @spec validate_for_delete(t(), %{(atom() | binary()) => term()}) ::
          {:ok, Request.t()} | {:error, Response.t()}
  def validate_for_delete(%Api{} = api, params) do
    with :ok <- hold_until_stack_ready(api) do
      Api.Delete.validate_for_delete(api, params)
    end
  end

  defp validate_params(api, params) do
    with {:ok, request_params} <- Api.Params.validate(api, params) do
      request_for_params(
        api,
        request_params,
        %Response{
          api: api,
          params: request_params,
          shape_definition: request_params.shape_definition
        }
      )
    end
  end

  @doc false
  def request_for_params(%Api{} = api, request_params, response \\ %Response{}) do
    {:ok,
     %Request{
       api: api,
       params: request_params,
       response: response
     }}
  end

  @spec delete_shape(Request.t()) :: Response.t()
  def delete_shape(%Request{handle: handle} = request) when is_binary(handle) do
    %{api: %{stack_id: stack_id}} = request
    :ok = Shapes.clean_shape(stack_id, handle)

    # Delete responses don't need to have cleanup operations appended
    # after the body has been read, so mark them as finalized
    Response.final(%Response{status: 202, body: []})
  end

  def delete_shape(%Request{handle: nil} = request) do
    request
    |> Response.error("Shape not found", status: 404)
    |> Response.final()
  end

  @spec delete_shape(Plug.Conn.t()) :: Plug.Conn.t()
  def delete_shape(%Plug.Conn{} = conn, %Request{} = request) do
    response = delete_shape(request)
    Response.send(conn, response)
  end

  @spec options(Plug.Conn.t()) :: Plug.Conn.t()
  def options(%Plug.Conn{} = conn) do
    Api.Options.call(conn)
  end

  defp seek(%Request{params: %{offset: :now}} = request) do
    # For "now" offset, return immediately with up-to-date message
    # and the last_offset from the shape
    request
    |> determine_global_last_seen_lsn()
    |> use_last_offset_as_chunk_end()
    |> set_response_offset_for_now()
  end

  defp seek(%Request{} = request) do
    request
    |> listen_for_new_changes()
    |> determine_global_last_seen_lsn()
    |> determine_log_chunk_offset()
    |> determine_up_to_date()
  end

  defp set_response_offset_for_now(%Request{} = request) do
    Request.update_response(request, &%{&1 | up_to_date: true, offset: request.last_offset})
  end

  defp load_shape_info(%Request{} = request) do
    with_span(request, "shape_get.api.load_shape_info", fn ->
      request
      |> get_or_create_shape_handle()
      |> handle_shape_info(request)
    end)
  end

  # No handle is provided so we can get the existing one for this shape
  # or create a new shape if it does not yet exist
  defp get_or_create_shape_handle(%Request{params: %{handle: nil}} = request) do
    %{params: %{shape_definition: shape}, api: %{stack_id: stack_id}} = request
    Shapes.get_or_create_shape_handle(stack_id, shape)
  end

  # A shape handle is provided so we need to return the shape that matches the
  # shape handle and the shape definition
  defp get_or_create_shape_handle(%Request{} = request) do
    %{params: %{handle: handle, shape_definition: shape}, api: %{stack_id: stack_id}} = request

    Shapes.resolve_shape_handle(stack_id, handle, shape)
  end

  defp handle_shape_info(nil, %Request{} = request) do
    %{params: %{shape_definition: shape}, api: %{stack_id: stack_id}} = request
    # There is no shape that matches the shape definition (because shape info is `nil`).
    # Hence, create a new shape for this shape definition
    # and return a 409 with a redirect to the newly created shape.
    # (will be done by the recursive `handle_shape_info` call)
    stack_id
    |> Shapes.get_or_create_shape_handle(shape)
    |> handle_shape_info(request)
  end

  # Handle "now" offset - it's never out of bounds
  defp handle_shape_info(
         {active_shape_handle, last_offset},
         %Request{params: %{offset: :now, handle: shape_handle}} = request
       )
       when is_nil(shape_handle) or shape_handle == active_shape_handle do
    # We found a shape that matches the shape definition
    {:ok,
     Request.update_response(
       %{request | handle: active_shape_handle, last_offset: last_offset},
       &%{&1 | handle: active_shape_handle}
     )}
  end

  defp handle_shape_info(
         {active_shape_handle, last_offset},
         %Request{params: %{handle: shape_handle}} = request
       )
       when is_nil(shape_handle) or shape_handle == active_shape_handle do
    # We found a shape that matches the shape definition
    # and the shape has the same ID as the shape handle provided by the user
    {:ok,
     Request.update_response(
       %{request | handle: active_shape_handle, last_offset: last_offset},
       &%{&1 | handle: active_shape_handle}
     )}
  end

  defp handle_shape_info({active_shape_handle, _}, %Request{} = request) do
    # Either the requested shape handle exists or does not exist.
    # If it exists there is a mismatch between the shape definition and the shape handle
    # (otherwise we would have matched the previous function clause).
    # The mismatch may occur because the shape definition has changed,
    # which happens frequently when working with dependent shapes
    # where a shape's WHERE clause is constructed based on the values of another shape
    # (e.g. to load all children pointed at by a FK in a parent table).

    # If the shape handle does not exist, it may have never existed or it may have been deleted.
    # In either case we return a 409 with a location redirect for clients to
    # re-request the shape from scratch with the new shape id which acts as a consistent cache buster
    # e.g. GET /v1/shape?table={root_table}&handle={new_shape_handle}&offset=-1

    # TODO: discuss returning a 307 redirect rather than a 409, the client
    # will have to detect this and throw out old data
    error = Api.Error.must_refetch()

    {:error,
     Response.error(request, error.message,
       handle: active_shape_handle,
       status: error.status
     )}
  end

  defp hold_until_stack_ready(%Api{} = api, opts \\ []) do
    stack_id = stack_id(api)
    opts = Keyword.put_new(opts, :timeout, api.stack_ready_timeout)

    case Electric.StatusMonitor.wait_until_active(stack_id, opts) do
      :ok ->
        :ok

      :conn_sleeping ->
        # If the database connections are sleeping, initiate the scaleup process immediately
        # and hold the request until the stack becomes active again.
        #
        # Because the state change happens asynchronoously, we pass the
        # `block_on_conn_sleeping` flag to the next call of
        # `Electric.StatusMonitor.wait_until_active()` to prevent this request from getting
        # into a recursive spin loop until the status value changes in StatusMonitor's ETS table.
        Electric.Connection.Restarter.restore_connection_subsystem(stack_id)
        hold_until_stack_ready(api, block_on_conn_sleeping: true)

      {:error, message} ->
        Logger.warning("Stack not ready after #{opts[:timeout]}ms. Reason: #{message}")
        {:error, Response.error(api, message, status: 503, retry_after: 5)}
    end
  end

  defp listen_for_new_changes(%Request{params: %{live: false}} = request) do
    request
  end

  defp listen_for_new_changes(%Request{params: %{live: true}} = request) do
    %{
      last_offset: last_offset,
      handle: handle,
      params: %{offset: offset},
      api: %{stack_id: stack_id}
    } = request

    # Only start listening when we know there is a possibility that nothing is going to be returned
    # There is an edge case in that the snapshot is served in chunks but `last_offset` is not updated
    # by that process. In that case, we'll start listening for changes but not receive any updates.
    if LogOffset.compare(offset, last_offset) != :lt or
         last_offset == LogOffset.last_before_real_offsets() do
      ref = Electric.StackSupervisor.subscribe_to_shape_events(stack_id, handle)
      Logger.debug("Client #{inspect(self())} is registered for changes to #{handle}")

      %{request | new_changes_pid: self(), new_changes_ref: ref}
    else
      request
    end
  end

  defp determine_global_last_seen_lsn(%Request{} = request) do
    offset =
      request.api.stack_id
      |> Electric.LsnTracker.get_last_processed_lsn()
      |> Electric.Postgres.Lsn.to_integer()

    %{request | global_last_seen_lsn: offset}
  end

  # If the requested offset is out of bounds, we are beyond the end of any chunk
  defp determine_log_chunk_offset(%Request{} = request) when is_out_of_bounds(request) do
    Request.update_response(
      %{request | chunk_end_offset: request.last_offset},
      &%{&1 | offset: request.last_offset}
    )
  end

  # If chunk offsets are available, use those instead of the latest available
  # offset to optimize for cache hits and response sizes
  defp determine_log_chunk_offset(%Request{} = request) do
    %{handle: handle, last_offset: last_offset, params: %{offset: offset}, api: api} =
      request

    chunk_end_offset =
      Shapes.get_chunk_end_log_offset(api.stack_id, handle, offset) || last_offset

    Request.update_response(
      %{request | chunk_end_offset: chunk_end_offset},
      &%{&1 | offset: chunk_end_offset}
    )
  end

  # For "now" requests, use the last_offset directly as the chunk_end_offset
  defp use_last_offset_as_chunk_end(%Request{} = request) do
    %{request | chunk_end_offset: request.last_offset}
  end

  defp determine_up_to_date(%Request{} = request) do
    %{
      last_offset: last_offset,
      chunk_end_offset: chunk_end_offset,
      params: %{offset: offset}
    } = request

    latest_seen_offset = LogOffset.max(last_offset, offset)

    # The log can't be up to date if the last seen offset, whether by
    # us or the client, is not the actual end.
    # Also if client is requesting the start of the log, we don't set `up-to-date`
    # here either as we want to set a long max-age on the cache-control.
    if LogOffset.compare(chunk_end_offset, latest_seen_offset) == :lt ||
         offset == @before_all_offset do
      Request.update_response(request, &%{&1 | up_to_date: false})
    else
      Request.update_response(request, &%{&1 | up_to_date: true})
    end
  end

  def serve_shape_response(%Request{} = request) do
    if request.params.subset do
      serve_subset_response(request)
    else
      serve_shape_log(request)
    end
  end

  def serve_shape_response(%Plug.Conn{} = conn, %Request{} = request) do
    response =
      case if_not_modified(conn, request) do
        {:halt, response} ->
          Response.ensure_cleanup(response)

        {:cont, request} ->
          serve_shape_response(request)
      end

    conn
    |> Plug.Conn.assign(:response, response)
    |> Response.send(response)
  end

  def serve_subset_response(%Request{} = request) do
    if request.params.live_sse do
      Response.error(
        request,
        "Subset snapshots are a stable view of data, so SSE is not applicable"
      )
    end

    with_span(request, "shape_get.plug.serve_subset_response", fn ->
      do_serve_subset_response(request)
    end)
  end

  defp do_serve_subset_response(%Request{} = request) do
    %{
      response: response,
      params: %{subset: subset, shape_definition: shape_definition, handle: handle}
    } = request

    case Shapes.query_subset(handle, shape_definition, subset, request.api) do
      {:ok, {metadata, data_stream}} ->
        %{
          response
          | chunked: true,
            body: encode(request.api, :subset, {metadata, data_stream}),
            response_type: :subset
        }
        |> Response.final()

      {:error, {key, message}} when is_atom(key) ->
        Response.invalid_request(request, errors: %{subset: %{key => message}})

      {:error, reason} ->
        Response.error(request, inspect(reason), status: 500)
    end
  end

  @doc """
  Return shape log data.
  """
  @spec serve_shape_log(Request.t()) :: Response.t()
  def serve_shape_log(%Request{} = request) do
    validate_serve_usage!(request)

    with_span(request, "shape_get.plug.serve_shape_log", fn ->
      request
      |> do_serve_shape_log()
      |> Response.ensure_cleanup()
    end)
  end

  def serve_shape_log(%Plug.Conn{} = conn, %Request{} = request) do
    response =
      case if_not_modified(conn, request) do
        {:halt, response} ->
          Response.ensure_cleanup(response)

        {:cont, request} ->
          serve_shape_log(request)
      end

    conn
    |> Plug.Conn.assign(:response, response)
    |> Response.send(response)
  end

  def if_not_modified(conn, request) do
    etag = Response.etag(request.response, quote: false)

    if is_nil(request.params.subset) and etag in if_none_match(conn) do
      %{response: response} =
        Request.update_response(
          request,
          &%{&1 | status: 304, body: []}
        )

      {:halt, response}
    else
      {:cont, request}
    end
  end

  defp if_none_match(%Plug.Conn{} = conn) do
    Plug.Conn.get_req_header(conn, "if-none-match")
    |> Enum.flat_map(&String.split(&1, ","))
    |> Enum.map(&String.trim/1)
    |> Enum.map(&String.trim(&1, <<?">>))
  end

  defp validate_serve_usage!(request) do
    case {request.new_changes_pid, self()} do
      {nil, _} ->
        :ok

      {pid, pid} when is_pid(pid) ->
        :ok

      {_, _} ->
        raise RuntimeError,
          message:
            "Request.serve/1 must be called from the same process that called Request.validate/2"
    end
  end

  defp do_serve_shape_log(%Request{params: %{offset: :now}} = request) do
    # For "now" offset, return an immediate up-to-date response with no log data
    %{response: %Response{} = response, global_last_seen_lsn: global_last_seen_lsn} = request

    %{
      response
      | status: 200,
        body: encode_log(request, [up_to_date_ctl(global_last_seen_lsn)]),
        finalized?: true
    }
  end

  defp do_serve_shape_log(%Request{new_changes_ref: ref} = request)
       when is_out_of_bounds(request) do
    # treat out of bounds requests like live requests with a
    # shorter timeout before failing them, as if the client happened
    # to be slightly ahead because of a restart or handover the
    # offset they have seen should show up shortly, otherwise we
    # assume it is an actually invalid out of bounds request
    Process.send_after(
      self(),
      {ref, :out_of_bounds_timeout},
      div(request.api.long_poll_timeout, 2)
    )

    handle_live_request(request)
  end

  defp do_serve_shape_log(%Request{} = request) do
    %{
      handle: shape_handle,
      chunk_end_offset: chunk_end_offset,
      global_last_seen_lsn: global_last_seen_lsn,
      params: %{offset: offset, live: live?, live_sse: in_sse?},
      api: %{stack_id: stack_id},
      response: response
    } = request

    case Shapes.get_merged_log_stream(stack_id, shape_handle,
           since: offset,
           up_to: chunk_end_offset,
           live_sse: in_sse?
         ) do
      {:ok, log} ->
        if live? && Enum.take(log, 1) == [] do
          handle_live_request(request)
        else
          up_to_date_lsn =
            if live? do
              # In live mode, if we've gotten an actual update and are here and not in `no_change_response`,
              # then for this shape and this request we trust the locally last seen LSN.
              chunk_end_offset.tx_offset
            else
              # In non-live mode, we're reading from disk. We trust the global max because it's updated
              # after all disk writes. We take the max because we might be reading from disk before a global update.
              max(global_last_seen_lsn, chunk_end_offset.tx_offset)
            end

          log_stream = Stream.concat(log, maybe_up_to_date(request, up_to_date_lsn))

          %{response | chunked: true, body: encode_log(request, log_stream)}
        end

      {:error, %Api.Error{} = error} ->
        Response.error(request, error.message, status: error.status)

      {:error, :unknown} ->
        # the shape has been deleted between the request validation and the attempt
        # to return the log stream
        error = Api.Error.must_refetch()
        Response.error(request, error.message, status: error.status)

      {:error, %SnapshotError{type: :schema_changed}} ->
        error = Api.Error.must_refetch()
        Logger.warning("Schema changed while creating snapshot for #{shape_handle}")
        Response.error(request, error.message, status: error.status)

      {:error, %SnapshotError{} = error} ->
        Logger.warning("Failed to create snapshot for #{shape_handle}: #{error.message}")

        if error.type == :unknown &&
             DbConnectionError.from_error(error.original_error).type == :unknown do
          Logger.error("Unknown error while creating snapshot: #{inspect(error.original_error)}")
          message = "Unexpected error while creating snapshot: " <> error.message
          Response.error(request, message, status: 500)
        else
          Response.error(request, error.message, status: 503, known_error: true, retry_after: 10)
        end

      {:error, error} ->
        # Errors will be logged further up the stack
        message =
          case error do
            msg when is_binary(msg) ->
              msg

            %{__exception__: true} ->
              Exception.format(:error, error, [])

            term ->
              inspect(term)
          end

        Response.error(
          request,
          "Unable to retrieve shape log: #{message}",
          status: 500
        )
    end
  end

  defp handle_live_request(%Request{params: %{live_sse: true}} = request) do
    request
    |> update_attrs(%{ot_is_immediate_response: false})
    |> notify_changes_since_request_start()
    |> stream_sse_events()
  end

  defp handle_live_request(%Request{} = request) do
    request
    |> update_attrs(%{ot_is_immediate_response: false})
    |> notify_changes_since_request_start()
    |> hold_until_change()
  end

  # Between loading the shape info and registering as a listener for new changes,
  # there is a short time period where information might be lost, so we  do an
  # explicit check if anything has changed.
  defp notify_changes_since_request_start(%Request{} = request) do
    %{
      new_changes_ref: ref,
      last_offset: last_offset,
      handle: shape_handle,
      params: %{shape_definition: shape_def},
      api: %{stack_id: stack_id}
    } = request

    Logger.debug(
      "Client #{inspect(self())} is checking for any changes to #{shape_handle} since start of request"
    )

    case Shapes.resolve_shape_handle(stack_id, shape_handle, shape_def) do
      {^shape_handle, ^last_offset} ->
        # no-op, shape is still present and unchanged
        nil

      {^shape_handle, latest_log_offset} when is_log_offset_lt(last_offset, latest_log_offset) ->
        send(self(), {ref, :new_changes, latest_log_offset})

      {^shape_handle, _latest_log_offset} ->
        # Fix for issue #3760: Handle offset regression during shape invalidation.
        #
        # This case handles a race condition where:
        # 1. Shape invalidation spawns an async cleanup task
        # 2. Between consumer termination and async cleanup completion, the writer
        #    ETS gets deleted while ShapeStatus retains the shape entry
        # 3. A pending API request queries the shape
        # 4. Validation succeeds (shape exists in ShapeStatus), but metadata reading
        #    fails, causing resolve_shape_handle to return LogOffset.last_before_real_offsets()
        # 5. This offset is less than the client's stored offset (offset regression)
        #
        # When the offset goes backwards, the shape has effectively been invalidated
        # and the client should refetch from the beginning.
        send(self(), {ref, :shape_rotation})

      {other_shape_handle, _} when other_shape_handle != shape_handle ->
        send(self(), {ref, :shape_rotation, other_shape_handle})

      nil ->
        send(self(), {ref, :shape_rotation})
    end

    request
  end

  defp hold_until_change(%Request{} = request) do
    %{
      new_changes_ref: ref,
      handle: shape_handle,
      api: %{long_poll_timeout: long_poll_timeout} = api
    } = request

    Logger.debug("Client #{inspect(self())} is waiting for changes to #{shape_handle}")

    receive do
      {^ref, :new_changes, latest_log_offset} ->
        # Stream new log since currently "held" offset
        %{request | last_offset: latest_log_offset}
        |> determine_global_last_seen_lsn()
        |> determine_log_chunk_offset()
        |> determine_up_to_date()
        |> do_serve_shape_log()

      {^ref, :shape_rotation, new_handle} ->
        error = Api.Error.must_refetch()

        Response.error(request, error.message,
          handle: new_handle,
          status: error.status
        )

      {^ref, :shape_rotation} ->
        error = Api.Error.must_refetch()
        Response.error(request, error.message, status: error.status)

      {^ref, :out_of_bounds_timeout} ->
        Logger.debug(fn ->
          "Client #{inspect(self())} timed out waiting for " <>
            "changes to #{shape_handle} (out-of-bounds check)"
        end)

        Response.invalid_request(api, errors: @offset_out_of_bounds)
    after
      # If we timeout, check that the stack is still up and
      # return an up-to-date message
      long_poll_timeout ->
        request = update_attrs(request, %{ot_is_long_poll_timeout: true})

        case Electric.StatusMonitor.status(api.stack_id) do
          %{shape: :up} ->
            request
            |> determine_global_last_seen_lsn()
            |> no_change_response()

          _ ->
            message = Electric.StatusMonitor.timeout_message(api.stack_id)
            Response.error(request, message, status: 503, retry_after: 10)
        end
    end
  end

  defp stream_sse_events(%Request{} = request) do
    %{
      new_changes_ref: ref,
      handle: shape_handle,
      api: %{keepalive_interval: keepalive_interval, sse_timeout: sse_timeout},
      params: %{offset: since_offset}
    } = request

    Logger.debug(
      "Client #{inspect(self())} is streaming SSE for changes to #{shape_handle} since #{inspect(since_offset)}"
    )

    # Set up timer for SSE comment as keep-alive
    keepalive_ref = Process.send_after(self(), {:sse_keepalive, ref}, keepalive_interval)

    # Set up timer for SSE timeout
    timeout_ref = Process.send_after(self(), {:sse_timeout, ref}, sse_timeout)

    # Stream changes as SSE events for the duration of the timer.
    sse_event_stream =
      Stream.resource(
        fn ->
          %SseState{
            mode: :receive,
            request: request,
            stream: nil,
            since_offset: since_offset,
            last_message_time: System.monotonic_time(:millisecond),
            keepalive_ref: keepalive_ref
          }
        end,
        &next_sse_event/1,
        fn %SseState{keepalive_ref: latest_keepalive_ref} ->
          Process.cancel_timer(latest_keepalive_ref)
          Process.cancel_timer(timeout_ref)
        end
      )

    response = %{request.response | chunked: true, body: sse_event_stream}

    %{response | trace_attrs: Map.put(response.trace_attrs, :ot_is_sse_response, true)}
  end

  defp next_sse_event(%SseState{mode: :receive} = state) do
    %{
      keepalive_ref: keepalive_ref,
      last_message_time: last_message_time,
      request:
        %{
          api: %{
            stack_id: stack_id,
            keepalive_interval: keepalive_interval
          },
          handle: shape_handle,
          new_changes_ref: ref
        } = request,
      since_offset: since_offset
    } = state

    receive do
      {^ref, :new_changes, latest_log_offset} ->
        updated_request =
          %{request | last_offset: latest_log_offset}
          |> determine_global_last_seen_lsn()
          |> determine_log_chunk_offset()
          |> determine_up_to_date()

        # This is usually but not always the `latest_log_offset`
        # as per `determine_log_chunk_offset/1`.
        end_offset = updated_request.chunk_end_offset

        case Shapes.get_merged_log_stream(
               stack_id,
               shape_handle,
               since: since_offset,
               up_to: end_offset,
               live_sse: true
             ) do
          {:ok, log} ->
            Process.cancel_timer(keepalive_ref)

            control_messages = maybe_up_to_date(updated_request, end_offset.tx_offset)
            message_stream = Stream.concat(log, control_messages)
            encoded_stream = encode_log(updated_request, message_stream)

            current_time = System.monotonic_time(:millisecond)

            new_keepalive_ref =
              Process.send_after(self(), {:sse_keepalive, ref}, keepalive_interval)

            {[],
             %{
               state
               | mode: :emit,
                 stream: encoded_stream,
                 since_offset: end_offset,
                 last_message_time: current_time,
                 keepalive_ref: new_keepalive_ref
             }}

          {:error, _error} ->
            {[], state}
        end

      {^ref, :shape_rotation} ->
        {[], %{state | mode: :done}}

      {^ref, :out_of_bounds_timeout} ->
        {[], %{state | mode: :done}}

      {:sse_keepalive, ^ref} ->
        current_time = System.monotonic_time(:millisecond)
        time_since_last_message = current_time - last_message_time

        if time_since_last_message >= keepalive_interval do
          new_keepalive_ref =
            Process.send_after(self(), {:sse_keepalive, ref}, keepalive_interval)

          {[": keep-alive\n\n"],
           %{state | last_message_time: current_time, keepalive_ref: new_keepalive_ref}}
        else
          # Not time to send a keep-alive yet, schedule for the remaining time
          remaining_time = keepalive_interval - time_since_last_message
          new_keepalive_ref = Process.send_after(self(), {:sse_keepalive, ref}, remaining_time)

          {[], %{state | keepalive_ref: new_keepalive_ref}}
        end

      {:sse_timeout, ^ref} ->
        {[], %{state | mode: :done}}
    end
  end

  defp next_sse_event(%SseState{mode: :emit} = state) do
    %{stream: stream} = state

    # Can change the number taken to adjust the grouping. Currently three
    # because there's typically 3 elements per SSE -- the actual message
    # and the "data: " and "\n\n" delimiters around it.
    #
    # The JSON encoder groups stream elements by 500. So perhaps this
    # could be a larger number for more efficiency?
    case StreamSplit.take_and_drop(stream, 3) do
      {[], _tail} ->
        {[], %{state | mode: :receive, stream: nil}}

      {head, tail} ->
        {head, %{state | stream: tail}}
    end
  end

  defp next_sse_event(%SseState{mode: :done} = state), do: {:halt, state}

  defp no_change_response(%Request{} = request) do
    %{response: response, global_last_seen_lsn: global_last_seen_lsn} =
      update_attrs(request, %{ot_is_empty_response: true})

    %{
      response
      | status: 200,
        no_changes: true,
        body: encode_log(request, [up_to_date_ctl(global_last_seen_lsn)])
    }
  end

  defp update_attrs(%Request{} = request, attrs) do
    Request.update_response(request, fn response ->
      Map.update!(response, :trace_attrs, &Map.merge(&1, attrs))
    end)
  end

  defp maybe_up_to_date(%Request{response: %{up_to_date: true}}, up_to_date_lsn) do
    [up_to_date_ctl(up_to_date_lsn)]
  end

  defp maybe_up_to_date(%Request{response: %{up_to_date: false}}, _) do
    []
  end

  defp up_to_date_ctl(up_to_date_lsn) do
    %{headers: %{control: "up-to-date", global_last_seen_lsn: to_string(up_to_date_lsn)}}
  end

  defp with_span(%Request{} = request, name, attributes \\ [], fun) do
    OpenTelemetry.with_span(name, attributes, stack_id(request), fun)
  end

  @spec stack_id(Api.t() | Request.t() | Response.t()) :: String.t()
  def stack_id(%Api{stack_id: stack_id}), do: stack_id
  def stack_id(%{api: %{stack_id: stack_id}}), do: stack_id

  defp encode_log(%Request{api: api, params: %{live: true, live_sse: true}}, stream) do
    encode_sse(api, :log, stream)
  end

  defp encode_log(%Request{api: api}, stream) do
    encode(api, :log, stream)
  end

  # Error messages are encoded normally, even when using SSE
  # because they are returned on the original fetch request
  # with a status code that is not 2xx.
  @spec encode_error_message(Api.t() | Request.t(), term()) :: Enum.t()
  def encode_error_message(%Api{} = api, message) do
    encode(api, :message, message)
  end

  def encode_error_message(%Request{api: api}, message) do
    encode(api, :message, message)
  end

  @spec encode_message(Request.t(), term()) :: Enum.t()
  def encode_message(
        %Request{api: api, params: %{live: true, live_sse: true}},
        message
      ) do
    encode_sse(api, :message, message)
  end

  def encode_message(%Request{api: api}, message) do
    encode(api, :message, message)
  end

  defp encode(%Api{encoder: encoder}, type, message)
       when type in [:message, :log, :subset] do
    apply(encoder, type, [message])
  end

  defp encode_sse(%Api{sse_encoder: sse_encoder}, type, message) when type in [:message, :log] do
    apply(sse_encoder, type, [message])
  end

  def schema(%Response{
        api: %Api{inspector: inspector},
        shape_definition: %Shapes.Shape{} = shape
      }) do
    # This technically does double work because we've already fetched this info to build the shape,
    # but that's not a big deal as it's all ETS backed. This also has an added benefit that
    # if table schema changes in a way that doesn't invalidate the shape or we can't detect
    # (e.g. column nullability changes but the type remains the same), we might return the new
    # version if it's invalidated in ETS or server is restarted.
    case Inspector.load_column_info(shape.root_table_id, inspector) do
      {:ok, columns} ->
        Electric.Schema.from_column_info(columns, shape.selected_columns)

      {:error, :connection_not_available} ->
        # TODO: we currently only convert DBConnection errors to proper 503s, we should
        # handle a custom error we can more easily propagate
        raise %DBConnection.ConnectionError{message: "Cannot connect to the database."}

      :table_not_found ->
        nil
    end
  end

  def schema(_req) do
    nil
  end

  @impl Access
  def fetch(%__MODULE__{} = config, key) do
    Map.fetch(config, key)
  end

  @impl Access
  def get_and_update(%__MODULE__{} = _config, _key, _function) do
    raise RuntimeError, message: "Cannot get_and_update a #{inspect(__MODULE__)} struct"
  end

  @impl Access
  def pop(%__MODULE__{} = _config, _key) do
    raise RuntimeError, message: "Cannot pop a #{inspect(__MODULE__)} struct"
  end
end
