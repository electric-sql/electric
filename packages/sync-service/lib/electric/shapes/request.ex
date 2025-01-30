defmodule Electric.Shapes.Request do
  alias Electric.Replication.LogOffset
  alias Electric.Shapes
  alias Electric.Shapes.Request, as: R
  alias Electric.Shapes.Response
  alias Electric.Telemetry.OpenTelemetry

  import Electric.Replication.LogOffset, only: [is_log_offset_lt: 2]

  require Logger

  defguardp is_configured(request) when not is_nil(request.config)
  defguardp is_valid(request) when request.valid == true

  defstruct [
    :chunk_end_offset,
    :handle,
    :last_offset,
    :new_changes_ref,
    :new_changes_pid,
    config: %R.Config{},
    params: %R.Params{},
    response: %Response{},
    valid: false
  ]

  @type t() :: %__MODULE__{
          config: Map.t(),
          params: Request.Params.t()
        }

  # @keys __struct__() |> Map.from_struct() |> Map.keys()

  # Aliasing for pattern matching
  @before_all_offset LogOffset.before_all()

  @shape_definition_mismatch %{
    message:
      "The specified shape definition and handle do not match. " <>
        "Please ensure the shape definition is correct or omit " <>
        "the shape handle from the request to obtain a new one."
  }

  @up_to_date %{headers: %{control: "up-to-date"}}
  @up_to_date_json Jason.encode!(@up_to_date)
  @offset_out_of_bounds %{offset: ["out of bounds for this shape"]}
  @must_refetch [%{headers: %{control: "must-refetch"}}]

  def configure(opts) do
    config = R.Config.new(opts)

    used_keys = config |> Map.from_struct() |> Map.keys()
    unused_opts = Keyword.drop(opts, used_keys)
    {%__MODULE__{config: config}, unused_opts}
  end

  @doc """
  Validate the parameters for the request.

  Options:

  - `seek: boolean()` - (default: true) once validated should we load the shape's
    latest offset information.
  """
  @spec validate(t(), %{(atom() | binary()) => term()}) :: {:ok, t()} | {:error, Response.t()}
  def validate(request, params, opts \\ [seek: true, load: true])

  def validate(request, params, seek: seek?, load: load?) when is_configured(request) do
    with :ok <- hold_until_stack_ready(request) do
      with {:ok, request} <- validate_params(request, params),
           {:ok, request} <- load_shape_info(request, load?) do
        {:ok, seek(request, seek?)}
      end
    end
  end

  defp validate_params(request, params) do
    with {:ok, request_params} <- R.Params.validate(request, params) do
      {:ok,
       %{
         request
         | params: request_params,
           valid: true,
           response: %Response{shape: request_params.shape_definition}
       }}
    end
  end

  @doc """
  A utility function to serve a configured, valid request to completion
  """
  def serve(%R{} = request) when is_valid(request) do
    serve_shape_log(request)
  end

  defp seek(%R{} = request, false), do: request

  defp seek(%R{} = request, true) do
    request
    |> listen_for_new_changes()
    |> determine_log_chunk_offset()
    |> determine_up_to_date()
  end

  defp load_shape_info(%R{} = request, false) do
    {:ok, request}
  end

  defp load_shape_info(%R{} = request, true) do
    with_span(request, "shape_get.plug.load_shape_info", fn ->
      request
      |> get_or_create_shape_handle()
      |> handle_shape_info(request)
    end)
  end

  # No handle is provided so we can get the existing one for this shape
  # or create a new shape if it does not yet exist
  defp get_or_create_shape_handle(%R{params: %{handle: nil}} = request) do
    %{params: %{shape_definition: shape}, config: config} = request
    Shapes.get_or_create_shape_handle(config, shape)
  end

  # A shape handle is provided so we need to return the shape that matches the
  # shape handle and the shape definition
  defp get_or_create_shape_handle(%R{} = request) do
    %{params: %{shape_definition: shape}, config: config} = request
    Shapes.get_shape(config, shape)
  end

  defp handle_shape_info(nil, %R{} = request) do
    %{params: %{shape_definition: shape, handle: shape_handle}, config: config} = request
    # There is no shape that matches the shape definition (because shape info is `nil`)
    if shape_handle != nil && Shapes.has_shape?(config, shape_handle) do
      # but there is a shape that matches the shape handle
      # thus the shape handle does not match the shape definition
      # and we return a 400 bad request status code
      {:error, Response.error(request, @shape_definition_mismatch)}
    else
      # The shape handle does not exist or no longer exists
      # e.g. it may have been deleted.
      # Hence, create a new shape for this shape definition
      # and return a 409 with a redirect to the newly created shape.
      # (will be done by the recursive `handle_shape_info` call)
      config
      |> Shapes.get_or_create_shape_handle(shape)
      |> handle_shape_info(request)
    end
  end

  defp handle_shape_info(
         {active_shape_handle, last_offset},
         %R{params: %{offset: offset, handle: shape_handle}} = request
       )
       when (is_nil(shape_handle) or shape_handle == active_shape_handle) and
              is_log_offset_lt(last_offset, offset) do
    {:error, Response.error(request, @offset_out_of_bounds)}
  end

  defp handle_shape_info(
         {active_shape_handle, last_offset},
         %R{params: %{handle: shape_handle}} = request
       )
       when is_nil(shape_handle) or shape_handle == active_shape_handle do
    # We found a shape that matches the shape definition
    # and the shape has the same ID as the shape handle provided by the user
    {:ok,
     Map.update!(
       %{request | handle: active_shape_handle, last_offset: last_offset},
       :response,
       &%{&1 | handle: active_shape_handle}
     )}
  end

  defp handle_shape_info({active_shape_handle, _}, %R{params: %{handle: shape_handle}} = request) do
    if Shapes.has_shape?(request.config, shape_handle) do
      # The shape with the provided ID exists but does not match the shape definition
      # otherwise we would have found it and it would have matched the previous function clause
      {:error, Response.error(request, @shape_definition_mismatch)}
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

  defp hold_until_stack_ready(%R{} = request) do
    stack_id = stack_id(request)
    stack_ready_timeout = Access.get(request.config, :stack_ready_timeout, 5_000)
    stack_events_registry = request.config[:stack_events_registry]

    ref = Electric.StackSupervisor.subscribe_to_stack_events(stack_events_registry, stack_id)

    if Electric.ProcessRegistry.alive?(stack_id, Electric.Replication.Supervisor) do
      :ok
    else
      receive do
        {:stack_status, ^ref, :ready} ->
          :ok
      after
        stack_ready_timeout ->
          {:error, Response.error(request, %{message: "Stack not ready"}, status: 503)}
      end
    end
  end

  defp listen_for_new_changes(%R{params: %{live: false}} = request) do
    request
  end

  defp listen_for_new_changes(%R{params: %{live: true}} = request) do
    %{
      last_offset: last_offset,
      handle: handle,
      params: %{offset: offset},
      config: %{registry: registry}
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
  defp determine_log_chunk_offset(%R{} = request) do
    %{handle: handle, last_offset: last_offset, params: %{offset: offset}, config: config} =
      request

    chunk_end_offset =
      Shapes.get_chunk_end_log_offset(config, handle, offset) || last_offset

    Map.update!(
      %{request | chunk_end_offset: chunk_end_offset},
      :response,
      &%{&1 | offset: chunk_end_offset}
    )
  end

  defp determine_up_to_date(%R{} = request) do
    %{
      last_offset: last_offset,
      chunk_end_offset: chunk_end_offset,
      params: %{offset: offset}
    } = request

    # The log can't be up to date if the last_offset is not the actual end.
    # Also if client is requesting the start of the log, we don't set `up-to-date`
    # here either as we want to set a long max-age on the cache-control.
    if LogOffset.compare(chunk_end_offset, last_offset) == :lt || offset == @before_all_offset do
      Map.update!(request, :response, &%{&1 | up_to_date: false})
    else
      Map.update!(request, :response, &%{&1 | up_to_date: true})
    end
  end

  @doc """
  Return shape log data.
  """
  def serve_shape_log(%R{} = request) do
    validate_serve_usage!(request)

    with_span(request, "shape_get.plug.serve_shape_log", fn ->
      request
      |> do_serve_shape_log()
      |> then(fn %{response: response} -> response end)
    end)
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

  defp do_serve_shape_log(%R{} = request) do
    %{
      handle: shape_handle,
      chunk_end_offset: chunk_end_offset,
      params: %{offset: offset, live: live?},
      config: config
    } = request

    log =
      Shapes.get_merged_log_stream(config, shape_handle,
        since: offset,
        up_to: chunk_end_offset
      )

    if live? && Enum.take(log, 1) == [] do
      request
      |> update_attrs(%{ot_is_immediate_response: false})
      |> hold_until_change()
    else
      body = Stream.concat([log, maybe_up_to_date(request)])

      Map.update!(request, :response, &%{&1 | chunked: true, body: encode_log(request, body)})
    end
  end

  defp hold_until_change(%R{} = request) do
    %{
      new_changes_ref: ref,
      handle: shape_handle,
      config: %{long_poll_timeout: long_poll_timeout}
    } = request

    Logger.debug("Client #{inspect(self())} is waiting for changes to #{shape_handle}")

    receive do
      {^ref, :new_changes, latest_log_offset} ->
        # Stream new log since currently "held" offset
        %{request | last_offset: latest_log_offset, chunk_end_offset: latest_log_offset}
        |> Map.update!(:response, &%{&1 | offset: latest_log_offset})
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

  defp empty_response(%R{} = request) do
    request
    |> update_attrs(%{ot_is_empty_response: true})
    |> Map.update!(:response, &%{&1 | status: 204, body: encode_log(request, [@up_to_date])})
  end

  defp update_attrs(%R{response: response} = request, attrs) do
    %{request | response: Map.update!(response, :trace_attrs, &Map.merge(&1, attrs))}
  end

  defp maybe_up_to_date(%R{response: %{up_to_date: true}}) do
    [@up_to_date_json]
  end

  defp maybe_up_to_date(%R{response: %{up_to_date: false}}) do
    []
  end

  defp with_span(%R{} = request, name, attributes \\ [], fun) do
    OpenTelemetry.with_span(name, attributes, stack_id(request), fun)
  end

  def stack_id(%R{config: %{stack_id: stack_id}}), do: stack_id

  defp encode_log(request, stream) do
    encode(request, :log, stream)
  end

  @spec encode_message(t(), term()) :: Enum.t()
  def encode_message(request, message) do
    encode(request, :message, message)
  end

  defp encode(%R{config: %{encoder: encoder}}, type, message) when type in [:message, :log] do
    apply(encoder, type, [message])
  end
end
