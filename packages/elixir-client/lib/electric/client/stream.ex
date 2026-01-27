defmodule Electric.Client.Stream do
  @moduledoc false

  alias Electric.Client.Fetch
  alias Electric.Client.Message
  alias Electric.Client.TagTracker
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
    # Move-out support: tracks tags per key and keys per tag
    # tag_to_keys: %{tag_value => MapSet<key>} - which keys have this tag
    # key_data: %{key => %{tags: MapSet<tag>, msg: msg}} - each key's tags and latest message
    tag_to_keys: %{},
    key_data: %{}
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
          id: integer(),
          client: Client.t(),
          shape: Client.shape() | nil,
          schema: Client.schema(),
          value_mapper_fun: Client.ValueMapper.mapper_fun(),
          parser: nil | {module(), term()},
          buffer: :queue.queue(),
          up_to_date?: boolean(),
          offset: Client.offset(),
          replica: Client.replica(),
          shape_handle: nil | Client.shape_handle(),
          next_cursor: binary() | nil,
          state: :init | :stream | :done,
          opts: opts(),
          tag_to_keys: %{optional(term()) => MapSet.t()},
          key_data: %{optional(term()) => %{tags: MapSet.t(), msg: Message.ChangeMessage.t()}}
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
    |> Enum.flat_map(&Message.parse(&1, shape_handle, value_mapper_fun, resp.request_timestamp))
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
    |> buffer(
      Enum.flat_map(
        resp.body,
        &Message.parse(&1, handle, value_mapper_fun, resp.request_timestamp)
      )
    )
    |> dispatch()
  end

  defp handle_response({:error, %Fetch.Response{} = resp}, stream) do
    %Fetch.Response{body: body} = resp

    handle_error(%Client.Error{message: unwrap_error(body), resp: resp}, stream)
  end

  defp handle_response({:error, error}, stream) do
    handle_error(%Client.Error{message: "Unable to retrieve data stream", resp: error}, stream)
  end

  defp handle_msg(%Message.ControlMessage{control: :up_to_date} = msg, stream) do
    handle_up_to_date(%{stream | buffer: :queue.in(msg, stream.buffer), up_to_date?: true})
  end

  defp handle_msg(%Message.ControlMessage{control: :snapshot_end} = _msg, stream) do
    {:cont, stream}
  end

  defp handle_msg(%Message.ChangeMessage{} = msg, stream) do
    {tag_to_keys, key_data} =
      TagTracker.update_tag_index(stream.tag_to_keys, stream.key_data, msg)

    {:cont,
     %{stream | buffer: :queue.in(msg, stream.buffer), tag_to_keys: tag_to_keys, key_data: key_data}}
  end

  defp handle_msg(
         %Message.MoveOutMessage{patterns: patterns, request_timestamp: request_timestamp} = _msg,
         stream
       ) do
    # Assumption: move-out events are only emitted after the initial snapshot is complete.
    # We therefore apply them immediately and do not buffer for later inserts.

    # Generate synthetic deletes for rows matching the move-out patterns
    {synthetic_deletes, updated_tag_to_keys, updated_key_data} =
      TagTracker.generate_synthetic_deletes(
        stream.tag_to_keys,
        stream.key_data,
        patterns,
        request_timestamp
      )

    # Add synthetic deletes to the buffer
    buffer =
      Enum.reduce(synthetic_deletes, stream.buffer, fn delete_msg, buf ->
        :queue.in(delete_msg, buf)
      end)

    {:cont,
     %{stream | buffer: buffer, tag_to_keys: updated_tag_to_keys, key_data: updated_key_data}}
  end

  defp handle_up_to_date(%{opts: %{live: true}} = stream) do
    {:cont, stream}
  end

  defp handle_up_to_date(%{opts: %{live: false}} = stream) do
    resume_message = %Message.ResumeMessage{
      schema: stream.schema,
      offset: stream.offset,
      shape_handle: stream.shape_handle,
      tag_to_keys: stream.tag_to_keys,
      key_data: stream.key_data
    }

    {:halt, %{stream | buffer: :queue.in(resume_message, stream.buffer), state: :done}}
  end

  defp unwrap_error([]), do: "Unknown error"
  defp unwrap_error([msg]), do: msg
  defp unwrap_error([_ | _] = msgs), do: msgs
  defp unwrap_error(msg), do: msg

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
        tag_to_keys: %{},
        key_data: %{}
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
    tag_to_keys = Map.get(resume, :tag_to_keys, %{})
    key_data = Map.get(resume, :key_data, %{})

    stream = %{
      stream
      | shape_handle: shape_handle,
        offset: offset,
        tag_to_keys: tag_to_keys,
        key_data: key_data,
        up_to_date?: true
    }

    if schema do
      generate_value_mapper(schema, stream)
    else
      stream
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
