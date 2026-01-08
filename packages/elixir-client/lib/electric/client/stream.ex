defmodule Electric.Client.Stream do
  @moduledoc false

  alias Electric.Client.Fetch
  alias Electric.Client.Message
  alias Electric.Client.MoveState
  alias Electric.Client

  defstruct [
    :id,
    :client,
    :shape,
    :schema,
    :value_mapper_fun,
    parser: {Electric.Client.ValueMapper, []},
    buffer: :queue.new(),
    up_to_date?: false,
    replica: :default,
    offset: Client.Offset.before_all(),
    shape_handle: nil,
    next_cursor: nil,
    state: :init,
    opts: %{},
    # Move state for tracking tags (shapes with subqueries)
    move_state: nil,
    # Buffered move-out events during initial sync
    buffered_move_outs: []
  ]

  @external_options [
    parser: [
      type: {:or, [nil, :mod_arg]},
      default: nil,
      doc: """
      A `{module, args}` tuple specifying the `Electric.Client.ValueMapper`
      implementation to use for mapping values from the sync stream into Elixir
      terms.
      """
    ],
    live: [
      type: :boolean,
      default: true,
      doc: "If `true` (the default) reads an infinite stream of update messages from the server."
    ],
    replica: [
      type: {:in, [:full, :default]},
      default: :default,
      type_spec: quote(do: :default | :full),
      doc:
        "Instructs the server to send just the changed columns for an update (`:modified`) or the full row (`:full`)."
    ],
    resume: [
      type: {:or, [nil, {:struct, Message.ResumeMessage}]},
      type_spec: quote(do: Message.ResumeMessage.t() | nil),
      doc: """
      Resume the stream from the given point. `Message.ResumeMessage` messages
      are appended to the change stream if you terminate it early using `live:
      false`
      """
    ],
    errors: [
      type: {:in, [:raise, :stream]},
      default: :raise,
      type_spec: quote(do: :raise | :stream),
      doc: """
      How errors from the Electric server should be handled.

      - `:raise` (default) - raise an exception if the server returns an error
      - `:stream` - put the error into the message stream (and terminate)
      """
    ]
  ]
  @external_schema NimbleOptions.new!(@external_options)
  @schema NimbleOptions.new!(
            @external_options ++
              [
                client: [type: {:struct, Electric.Client}, required: true]
              ]
          )

  @opts_schema NimbleOptions.new!(
                 live: [type: :boolean, default: true],
                 resume: [type: {:struct, Message.ResumeMessage}],
                 errors: [
                   type: {:in, [:raise, :stream]},
                   default: :stream
                 ]
               )

  @type opts :: %{
          live: boolean(),
          resume: nil | Message.ResumeMessage.t(),
          errors: :raise | :stream
        }

  @type t :: %__MODULE__{
          client: Client.t(),
          schema: Client.schema(),
          value_mapper_fun: Client.ValueMapper.mapper_fun(),
          parser: nil | {module(), term()},
          buffer: :queue.queue(),
          up_to_date?: boolean(),
          offset: Client.offset(),
          replica: Client.replica(),
          shape_handle: nil | Client.shape_handle(),
          state: :init | :stream | :done,
          opts: opts(),
          move_state: MoveState.t() | nil,
          buffered_move_outs: [Message.EventMessage.t()]
        }

  alias __MODULE__, as: S

  def new(%Client{} = client, opts) do
    opts
    |> Keyword.put(:client, client)
    |> new()
  end

  def new(%Client{} = client) do
    new(client, [])
  end

  def new(attrs) when is_list(attrs) do
    {core, opts} =
      attrs
      |> NimbleOptions.validate!(@schema)
      |> Keyword.split([:client, :parser, :replica])

    opts = NimbleOptions.validate!(Map.new(opts), @opts_schema)

    id = generate_id()

    struct(__MODULE__, Keyword.put(core, :opts, opts) |> Keyword.put(:id, id))
  end

  defp generate_id do
    System.unique_integer([:positive, :monotonic])
  end

  def next(%S{buffer: buffer} = stream) do
    case :queue.out(buffer) do
      {{:value, elem}, buffer} -> {[elem], %{stream | buffer: buffer}}
      {:empty, buffer} -> fetch(%{stream | buffer: buffer})
    end
  end

  @doc false
  def options_schema do
    @external_schema
  end

  defp fetch(%S{state: :done} = stream) do
    {:halt, stream}
  end

  defp fetch(%S{state: :init} = stream) do
    stream
    |> resume()
    |> stream_state()
    |> fetch()
  end

  defp fetch(%S{} = stream) do
    stream
    |> make_request()
    |> handle_response(stream)
    |> after_fetch()
  end

  defp ensure_enum(body) do
    case Enumerable.impl_for(body) do
      nil -> List.wrap(body)
      Enumerable.Map -> List.wrap(body)
      _impl -> body
    end
  end

  defp handle_response(%Fetch.Response{status: status} = resp, stream)
       when status in 200..299 do
    shape_handle = shape_handle!(resp)
    final_offset = last_offset(resp, stream.offset)
    next_cursor = resp.next_cursor

    %{value_mapper_fun: value_mapper_fun} =
      stream =
      handle_schema(resp, %{stream | shape_handle: shape_handle, next_cursor: next_cursor})
      |> Map.put(:offset, final_offset)

    resp.body
    |> ensure_enum()
    |> Enum.flat_map(&Message.parse(&1, shape_handle, value_mapper_fun))
    |> Enum.map(&Map.put(&1, :request_timestamp, resp.request_timestamp))
    |> Enum.reduce_while(stream, &handle_msg/2)
    |> dispatch()
  end

  # 409: Upon receiving a 409, we should start from scratch with the newly
  #      provided shape handle or with a fallback pseudo-handle to ensure
  #      a consistent cache buster is used
  defp handle_response({:error, %Fetch.Response{status: status} = resp}, stream)
       when status in [409] do
    %{value_mapper_fun: value_mapper_fun} = stream
    handle = shape_handle(resp) || "#{stream.shape_handle}-next"

    stream
    |> reset(handle)
    |> buffer(Enum.flat_map(resp.body, &Message.parse(&1, handle, value_mapper_fun)))
    |> dispatch()
  end

  defp handle_response({:error, %Fetch.Response{} = resp}, stream) do
    %Fetch.Response{body: body} = resp

    handle_error(%Client.Error{message: unwrap(body), resp: resp}, stream)
  end

  defp handle_response({:error, error}, stream) do
    handle_error(%Client.Error{message: "Unable to retrieve data stream", resp: error}, stream)
  end

  defp handle_msg(%Message.ControlMessage{control: :up_to_date} = msg, stream) do
    # Process any buffered move-outs before signaling up-to-date
    stream = process_buffered_move_outs(stream)
    handle_up_to_date(%{stream | buffer: :queue.in(msg, stream.buffer), up_to_date?: true})
  end

  defp handle_msg(%Message.ControlMessage{control: :snapshot_end} = _msg, stream) do
    # Snapshot-end messages are informational; we may use xmin/xmax/xip_list
    # for advanced visibility filtering in the future
    {:cont, stream}
  end

  defp handle_msg(%Message.ChangeMessage{} = msg, stream) do
    # Process tags for shapes with subqueries
    stream = process_change_tags(msg, stream)
    {:cont, %{stream | buffer: :queue.in(msg, stream.buffer)}}
  end

  defp handle_msg(%Message.EventMessage{event: :move_out} = msg, stream) do
    if stream.up_to_date? do
      # Process move-out immediately
      process_move_out(msg, stream)
    else
      # Buffer move-out until initial sync completes
      {:cont, %{stream | buffered_move_outs: [msg | stream.buffered_move_outs]}}
    end
  end

  defp handle_up_to_date(%{opts: %{live: true}} = stream) do
    {:cont, stream}
  end

  defp handle_up_to_date(%{opts: %{live: false}} = stream) do
    resume_message = %Message.ResumeMessage{
      schema: stream.schema,
      offset: stream.offset,
      shape_handle: stream.shape_handle
    }

    {:halt, %{stream | buffer: :queue.in(resume_message, stream.buffer), state: :done}}
  end

  # Process tags from a change message
  defp process_change_tags(%Message.ChangeMessage{} = msg, stream) do
    %{headers: headers, key: row_key} = msg
    %{tags: tags, removed_tags: removed_tags, operation: operation} = headers

    # Skip if no tags involved
    if tags == [] and removed_tags == [] do
      stream
    else
      move_state = stream.move_state || MoveState.new()

      move_state =
        case operation do
          :delete ->
            # Clear all tags for deleted row
            MoveState.clear_row(move_state, row_key)

          _ ->
            # Remove old tags, add new tags
            move_state
            |> MoveState.remove_tags_from_row(row_key, removed_tags)
            |> MoveState.add_tags_to_row(row_key, tags)
        end

      %{stream | move_state: move_state}
    end
  end

  # Process a move-out event
  defp process_move_out(%Message.EventMessage{patterns: patterns} = msg, stream) do
    move_state = stream.move_state || MoveState.new()

    {rows_to_delete, move_state} =
      Enum.reduce(patterns, {[], move_state}, fn pattern, {deletes, state} ->
        {new_deletes, state} = MoveState.process_move_out_pattern(state, pattern)
        {new_deletes ++ deletes, state}
      end)

    # Generate synthetic delete messages for rows with empty tag sets
    delete_msgs =
      Enum.map(rows_to_delete, fn row_key ->
        %Message.ChangeMessage{
          key: row_key,
          value: %{},
          headers: Message.Headers.delete(handle: stream.shape_handle),
          request_timestamp: msg.request_timestamp || DateTime.utc_now()
        }
      end)

    # Add delete messages to buffer
    buffer = Enum.reduce(delete_msgs, stream.buffer, &:queue.in/2)

    {:cont, %{stream | move_state: move_state, buffer: buffer}}
  end

  # Process buffered move-outs when up-to-date is received
  defp process_buffered_move_outs(%{buffered_move_outs: []} = stream), do: stream

  defp process_buffered_move_outs(%{buffered_move_outs: buffered} = stream) do
    # Process in original order (reverse since we prepended)
    stream =
      buffered
      |> Enum.reverse()
      |> Enum.reduce(%{stream | buffered_move_outs: []}, fn msg, stream ->
        {:cont, stream} = process_move_out(msg, stream)
        stream
      end)

    stream
  end

  defp unwrap([msg]), do: msg
  defp unwrap([_ | _] = msgs), do: msgs
  defp unwrap(msg), do: msg

  defp handle_error(error, %{opts: %{errors: :stream}} = stream) do
    %{stream | buffer: :queue.in(error, stream.buffer), state: :done}
    |> dispatch()
  end

  defp handle_error(error, _stream) do
    raise error
  end

  defp after_fetch({msgs, stream}) do
    {msgs, stream}
  end

  defp dispatch(%{buffer: buffer} = stream) do
    case :queue.out(buffer) do
      {{:value, elem}, buffer} -> {[elem], %{stream | buffer: buffer}}
      {:empty, buffer} -> {[], %{stream | buffer: buffer}}
    end
  end

  defp build_request(stream) do
    %{
      id: id,
      client: client,
      up_to_date?: up_to_date?,
      replica: replica,
      shape_handle: shape_handle,
      offset: offset,
      next_cursor: cursor
    } = stream

    Client.request(client,
      stream_id: id,
      offset: offset,
      shape_handle: shape_handle,
      replica: replica,
      live: up_to_date?,
      next_cursor: cursor
    )
  end

  defp make_request(stream) do
    stream
    |> build_request()
    |> make_request(stream)
  end

  defp make_request(request, stream) do
    Fetch.request(stream.client, request)
  end

  defp reset(stream, shape_handle) do
    %{
      stream
      | offset: Client.Offset.before_all(),
        shape_handle: shape_handle,
        up_to_date?: false,
        buffer: :queue.new(),
        schema: nil,
        value_mapper_fun: nil,
        move_state: nil,
        buffered_move_outs: []
    }
  end

  defp buffer(stream, msgs) when is_list(msgs) do
    %{stream | buffer: Enum.reduce(msgs, stream.buffer, &:queue.in/2)}
  end

  defp shape_handle!(resp) do
    shape_handle(resp) ||
      raise Client.Error, message: "Missing electric-handle header", resp: resp
  end

  defp shape_handle(%Fetch.Response{shape_handle: shape_handle}) do
    shape_handle
  end

  defp last_offset(%Fetch.Response{last_offset: nil}, offset) do
    offset
  end

  defp last_offset(%Fetch.Response{last_offset: offset}, _offset) do
    offset
  end

  defp last_offset(_resp, offset) do
    offset
  end

  defp handle_schema(%Fetch.Response{schema: schema}, %{value_mapper_fun: nil} = stream)
       when is_map(schema) do
    generate_value_mapper(schema, stream)
  end

  defp handle_schema(%Fetch.Response{}, %{value_mapper_fun: nil} = stream) do
    stream
  end

  defp handle_schema(_resp, %{value_mapper_fun: fun} = stream) when is_function(fun, 1) do
    stream
  end

  defp generate_value_mapper(schema, stream) do
    # by default the parser is defined in the shape definition, but we can
    # override that in the stream config
    {parser_module, parser_opts} = stream.parser || stream.client.parser

    value_mapper_fun = parser_module.for_schema(schema, parser_opts)

    %{stream | schema: schema, value_mapper_fun: value_mapper_fun}
  end

  defp resume(%{opts: %{resume: %Message.ResumeMessage{} = resume}} = stream) do
    %{shape_handle: shape_handle, offset: offset, schema: schema} = resume

    if schema do
      generate_value_mapper(schema, %{stream | shape_handle: shape_handle, offset: offset})
    else
      %{stream | shape_handle: shape_handle, offset: offset}
    end
  end

  defp resume(stream) do
    stream
  end

  defp stream_state(%{state: :init} = stream) do
    %{stream | state: :stream}
  end

  defimpl Enumerable do
    alias Electric.Client

    def count(_stream), do: {:error, __MODULE__}
    def member?(_stream, _element), do: {:error, __MODULE__}
    def slice(_stream), do: {:error, __MODULE__}

    def reduce(_stream, {:halt, acc}, _fun) do
      {:halted, acc}
    end

    def reduce(stream, {:suspend, acc}, fun) do
      {:suspended, acc, &reduce(stream, &1, fun)}
    end

    def reduce(stream, {:cont, acc}, fun) do
      case Client.Stream.next(stream) do
        {:halt, _stream} ->
          {:done, acc}

        {[entry], stream} ->
          reduce(stream, fun.(entry, acc), fun)

        {[], stream} ->
          reduce(stream, {:cont, acc}, fun)
      end
    end
  end
end
