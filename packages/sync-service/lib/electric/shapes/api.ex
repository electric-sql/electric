defmodule Electric.Shapes.Api do
  alias Electric.Replication.LogOffset
  alias Electric.Shapes
  alias Electric.Telemetry.OpenTelemetry

  alias __MODULE__
  alias __MODULE__.Request
  alias __MODULE__.Response

  import Electric.Replication.LogOffset, only: [is_log_offset_lt: 2]

  require Logger

  @options [
    inspector: [type: :mod_arg, required: true],
    pg_id: [type: {:or, [nil, :string]}],
    registry: [type: :atom, required: true],
    shape_cache: [type: :mod_arg, required: true],
    stack_events_registry: [type: :atom, required: true],
    stack_id: [type: :string, required: true],
    storage: [type: :mod_arg, required: true],
    persistent_kv: [
      type: {:custom, __MODULE__, :implements_persistent_kv, []},
      required: true
    ],
    allow_shape_deletion: [type: :boolean],
    long_poll_timeout: [type: :integer],
    max_age: [type: :integer],
    stack_ready_timeout: [type: :integer],
    stale_age: [type: :integer],
    encoder: [type: :atom]
  ]
  @schema NimbleOptions.new!(@options)
  @option_keys Keyword.keys(@options) |> MapSet.new()

  defguardp is_configured(api) when api.configured

  defstruct [
    :inspector,
    :pg_id,
    :registry,
    :persistent_kv,
    :shape,
    :shape_cache,
    :stack_events_registry,
    :stack_id,
    :storage,
    allow_shape_deletion: false,
    long_poll_timeout: 20_000,
    max_age: 60,
    stack_ready_timeout: 100,
    stale_age: 300,
    encoder: Electric.Shapes.Api.Encoder.JSON,
    configured: false
  ]

  @type t() :: %__MODULE__{}
  @type options() :: [unquote(NimbleOptions.option_typespec(@schema))]

  # Aliasing for pattern matching
  @before_all_offset LogOffset.before_all()
  @offset_out_of_bounds %{offset: ["out of bounds for this shape"]}
  @must_refetch [%{headers: %{control: "must-refetch"}}]

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

    Keyword.put(config, :api, api)
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
    with {:ok, params} <- normalise_shape_params(shape_params),
         opts = Keyword.merge(params, inspector: api.inspector),
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
    :ok = Shapes.clean_shape(handle, request.api)

    %Response{status: 202, body: []}
  end

  def delete_shape(%Request{handle: nil} = request) do
    Response.error(request, "Shape not found", status: 404)
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

  defp seek(%Request{} = request) do
    request
    |> listen_for_new_changes()
    |> determine_log_chunk_offset()
    |> determine_up_to_date()
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
    %{params: %{shape_definition: shape}, api: api} = request
    Shapes.get_or_create_shape_handle(api, shape)
  end

  # A shape handle is provided so we need to return the shape that matches the
  # shape handle and the shape definition
  defp get_or_create_shape_handle(%Request{} = request) do
    %{params: %{shape_definition: shape}, api: api} = request
    Shapes.get_shape(api, shape)
  end

  defp handle_shape_info(nil, %Request{} = request) do
    %{params: %{shape_definition: shape, handle: shape_handle}, api: api} = request
    # There is no shape that matches the shape definition (because shape info is `nil`)
    if shape_handle != nil && Shapes.has_shape?(api, shape_handle) do
      # but there is a shape that matches the shape handle
      # thus the shape handle does not match the shape definition
      # and we return a 400 bad request status code
      {:error, Response.shape_definition_mismatch(request)}
    else
      # The shape handle does not exist or no longer exists
      # e.g. it may have been deleted.
      # Hence, create a new shape for this shape definition
      # and return a 409 with a redirect to the newly created shape.
      # (will be done by the recursive `handle_shape_info` call)
      api
      |> Shapes.get_or_create_shape_handle(shape)
      |> handle_shape_info(request)
    end
  end

  defp handle_shape_info(
         {active_shape_handle, last_offset},
         %Request{params: %{offset: offset, handle: shape_handle}} = request
       )
       when (is_nil(shape_handle) or shape_handle == active_shape_handle) and
              is_log_offset_lt(last_offset, offset) do
    {:error, Response.invalid_request(request, errors: @offset_out_of_bounds)}
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

  defp handle_shape_info(
         {active_shape_handle, _},
         %Request{params: %{handle: shape_handle}} = request
       ) do
    if Shapes.has_shape?(request.api, shape_handle) do
      # The shape with the provided ID exists but does not match the shape definition
      # otherwise we would have found it and it would have matched the previous function clause
      {:error, Response.shape_definition_mismatch(request)}
    else
      # The requested shape_handle is not found, returns 409 along with a location redirect for clients to
      # re-request the shape from scratch with the new shape id which acts as a consistent cache buster
      # e.g. GET /v1/shape?table={root_table}&handle={new_shape_handle}&offset=-1

      # TODO: discuss returning a 307 redirect rather than a 409, the client
      # will have to detect this and throw out old data

      {:error,
       Response.error(request, @must_refetch,
         handle: active_shape_handle,
         status: 409
       )}
    end
  end

  defp hold_until_stack_ready(%Api{} = api) do
    stack_id = stack_id(api)

    ref =
      Electric.StackSupervisor.subscribe_to_stack_events(
        api.stack_events_registry,
        stack_id
      )

    if Electric.ProcessRegistry.alive?(stack_id, Electric.Replication.Supervisor) do
      :ok
    else
      receive do
        {:stack_status, ^ref, :ready} ->
          :ok
      after
        api.stack_ready_timeout ->
          {:error, Response.error(api, "Stack not ready", status: 503)}
      end
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
      api: %{registry: registry}
    } = request

    # Only start listening when we know there is a possibility that nothing is going to be returned
    # There is an edge case in that the snapshot is served in chunks but `last_offset` is not updated
    # by that process. In that case, we'll start listening for changes but not receive any updates.
    if LogOffset.compare(offset, last_offset) != :lt or
         last_offset == LogOffset.last_before_real_offsets() do
      ref = make_ref()
      Registry.register(registry, handle, ref)
      Logger.debug("Client #{inspect(self())} is registered for changes to #{handle}")

      %{request | new_changes_pid: self(), new_changes_ref: ref}
    else
      request
    end
  end

  # If chunk offsets are available, use those instead of the latest available
  # offset to optimize for cache hits and response sizes
  defp determine_log_chunk_offset(%Request{} = request) do
    %{handle: handle, last_offset: last_offset, params: %{offset: offset}, api: api} =
      request

    chunk_end_offset =
      Shapes.get_chunk_end_log_offset(api, handle, offset) || last_offset

    Request.update_response(
      %{request | chunk_end_offset: chunk_end_offset},
      &%{&1 | offset: chunk_end_offset}
    )
  end

  defp determine_up_to_date(%Request{} = request) do
    %{
      last_offset: last_offset,
      chunk_end_offset: chunk_end_offset,
      params: %{offset: offset}
    } = request

    # The log can't be up to date if the last_offset is not the actual end.
    # Also if client is requesting the start of the log, we don't set `up-to-date`
    # here either as we want to set a long max-age on the cache-control.
    if LogOffset.compare(chunk_end_offset, last_offset) == :lt || offset == @before_all_offset do
      Request.update_response(request, &%{&1 | up_to_date: false})
    else
      Request.update_response(request, &%{&1 | up_to_date: true})
    end
  end

  @doc """
  Return shape log data.
  """
  @spec serve_shape_log(Request.t()) :: Response.t()
  def serve_shape_log(%Request{} = request) do
    validate_serve_usage!(request)

    with_span(request, "shape_get.plug.serve_shape_log", fn ->
      do_serve_shape_log(request)
    end)
  end

  def serve_shape_log(%Plug.Conn{} = conn, %Request{} = request) do
    response =
      case if_not_modified(conn, request) do
        {:halt, response} ->
          response

        {:cont, request} ->
          serve_shape_log(request)
      end

    clean_up_change_listener(request)

    conn
    |> Plug.Conn.assign(:response, response)
    |> Response.send(response)
  end

  def if_not_modified(conn, request) do
    etag = Response.etag(request.response, quote: false)

    if etag in if_none_match(conn) do
      %{response: response} = Request.update_response(request, &%{&1 | status: 304, body: []})
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

  defp do_serve_shape_log(%Request{} = request) do
    %{
      handle: shape_handle,
      chunk_end_offset: chunk_end_offset,
      params: %{offset: offset, live: live?},
      api: api,
      response: response
    } = request

    case Shapes.get_merged_log_stream(api, shape_handle, since: offset, up_to: chunk_end_offset) do
      {:ok, log} ->
        if live? && Enum.take(log, 1) == [] do
          request
          |> update_attrs(%{ot_is_immediate_response: false})
          |> hold_until_change()
        else
          global_last_seen_lsn = get_global_last_seen_lsn(request)

          up_to_date_lsn =
            if live? do
              # In live mode, if we've gotten an actual update and are here and not in `empty_response`,
              # then for this shape and this request we trust the locally last seen LSN.
              chunk_end_offset.tx_offset
            else
              # In non-live mode, we're reading from disk. We trust the global max because it's updated
              # after all disk writes. We take the max because we might be reading from disk before a global update.
              max(global_last_seen_lsn, chunk_end_offset.tx_offset)
            end

          body = Stream.concat([log, maybe_up_to_date(request, up_to_date_lsn)])

          %{response | chunked: true, body: encode_log(request, body)}
        end

      {:error, error} ->
        # Errors will be logged further up the stack

        Response.error(
          request,
          "Unable retrieve shape log: #{Exception.format(:error, error, [])}",
          status: 500
        )
    end
  end

  defp hold_until_change(%Request{} = request) do
    %{
      new_changes_ref: ref,
      handle: shape_handle,
      api: %{long_poll_timeout: long_poll_timeout}
    } = request

    Logger.debug("Client #{inspect(self())} is waiting for changes to #{shape_handle}")

    receive do
      {^ref, :new_changes, latest_log_offset} ->
        # Stream new log since currently "held" offset
        %{request | last_offset: latest_log_offset, chunk_end_offset: latest_log_offset}
        |> Request.update_response(&%{&1 | offset: latest_log_offset})
        |> determine_up_to_date()
        |> do_serve_shape_log()

      {^ref, :shape_rotation} ->
        # We may want to notify the client better that the shape handle had
        # changed, but just closing the response and letting the client handle
        # it on reconnection is good enough.
        request
        |> update_attrs(%{ot_is_shape_rotated: true})
        |> empty_response()
    after
      # If we timeout, return an empty body and 204 as there's no response body.
      long_poll_timeout ->
        request
        |> update_attrs(%{ot_is_long_poll_timeout: true})
        |> empty_response()
    end
  end

  defp clean_up_change_listener(%Request{new_changes_ref: ref} = request)
       when is_reference(ref) do
    %{
      handle: shape_handle,
      api: %{registry: registry}
    } = request

    Registry.unregister_match(registry, shape_handle, ref)
    request
  end

  defp clean_up_change_listener(%Request{} = request), do: request

  defp empty_response(%Request{} = request) do
    %{response: response} = update_attrs(request, %{ot_is_empty_response: true})

    %{
      response
      | status: 204,
        body: encode_log(request, [up_to_date_ctl(get_global_last_seen_lsn(request))])
    }
  end

  defp get_global_last_seen_lsn(%Request{} = request) do
    Electric.Replication.PersistentReplicationState.get_last_processed_lsn(
      persistent_kv: request.api.persistent_kv,
      stack_id: request.api.stack_id
    )
    |> Electric.Postgres.Lsn.to_integer()
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
    %{headers: %{control: "up-to-date", global_last_seen_lsn: up_to_date_lsn}}
  end

  defp with_span(%Request{} = request, name, attributes \\ [], fun) do
    OpenTelemetry.with_span(name, attributes, stack_id(request), fun)
  end

  @spec stack_id(Api.t() | Request.t()) :: String.t()
  def stack_id(%Api{stack_id: stack_id}), do: stack_id
  def stack_id(%Request{api: %{stack_id: stack_id}}), do: stack_id

  defp encode_log(%Request{api: api}, stream) do
    encode(api, :log, stream)
  end

  @spec encode_message(Api.t() | Request.t(), term()) :: Enum.t()
  def encode_message(%Api{} = api, message) do
    encode(api, :message, message)
  end

  def encode_message(%Request{api: api}, message) do
    encode(api, :message, message)
  end

  defp encode(%Api{encoder: encoder}, type, message) when type in [:message, :log] do
    apply(encoder, type, [message])
  end

  def schema(%Request{params: params}) do
    schema(params)
  end

  def schema(%{shape_definition: %Shapes.Shape{} = shape}) do
    shape.table_info
    |> Map.fetch!(shape.root_table)
    |> Map.fetch!(:columns)
    |> Electric.Schema.from_column_info(shape.selected_columns)
  end

  def schema(_) do
    nil
  end

  @impl Access
  def fetch(%__MODULE__{} = config, key) do
    Map.fetch(config, key)
  end

  @impl Access
  def get_and_update(%__MODULE__{} = _config, _key, _function) do
    raise RuntimeError, message: "Cannot get_and_update a #{__MODULE__} struct"
  end

  @impl Access
  def pop(%__MODULE__{} = _config, _key) do
    raise RuntimeError, message: "Cannot pop a #{__MODULE__} struct"
  end
end
