defmodule Electric.Client.Stream do
  @moduledoc false

  alias Electric.Client.Fetch
  alias Electric.Client.Message
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
    # Tag index for move-out support: maps tag_value -> MapSet of {key, msg}
    tag_index: %{}
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
          opts: opts()
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
    handle_up_to_date(%{stream | buffer: :queue.in(msg, stream.buffer), up_to_date?: true})
  end

  defp handle_msg(%Message.ControlMessage{control: :snapshot_end} = _msg, stream) do
    {:cont, stream}
  end

  defp handle_msg(%Message.ChangeMessage{} = msg, stream) do
    stream = update_tag_index(stream, msg)
    {:cont, %{stream | buffer: :queue.in(msg, stream.buffer)}}
  end

  defp handle_msg(%Message.MoveOutMessage{patterns: patterns} = _msg, stream) do
    # Generate synthetic deletes for rows matching the move-out patterns
    {synthetic_deletes, updated_tag_index} = generate_synthetic_deletes(stream, patterns)

    # Add synthetic deletes to the buffer
    buffer =
      Enum.reduce(synthetic_deletes, stream.buffer, fn delete_msg, buf ->
        :queue.in(delete_msg, buf)
      end)

    {:cont, %{stream | buffer: buffer, tag_index: updated_tag_index}}
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
        tag_index: %{}
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

  # Tag index management for move-out support

  defp update_tag_index(stream, %Message.ChangeMessage{headers: headers, key: key} = msg) do
    tag_index = stream.tag_index

    # First, remove any tags that are being removed (for updates)
    tag_index = remove_from_tag_index(tag_index, headers.removed_tags, key)

    # Then add new tags
    tag_index = add_to_tag_index(tag_index, headers.tags, key, msg)

    # For deletes, also remove the row from all its tags
    tag_index =
      case headers.operation do
        :delete -> remove_from_tag_index(tag_index, headers.tags, key)
        _ -> tag_index
      end

    %{stream | tag_index: tag_index}
  end

  defp add_to_tag_index(tag_index, tags, key, msg) when is_list(tags) do
    Enum.reduce(tags, tag_index, fn tag, acc ->
      entries = Map.get(acc, tag, MapSet.new())
      Map.put(acc, tag, MapSet.put(entries, {key, msg}))
    end)
  end

  defp add_to_tag_index(tag_index, _tags, _key, _msg), do: tag_index

  defp remove_from_tag_index(tag_index, tags, key) when is_list(tags) do
    Enum.reduce(tags, tag_index, fn tag, acc ->
      case Map.get(acc, tag) do
        nil ->
          acc

        entries ->
          # Remove entries with matching key
          updated_entries =
            Enum.reject(entries, fn {entry_key, _msg} -> entry_key == key end)
            |> MapSet.new()

          if MapSet.size(updated_entries) == 0 do
            Map.delete(acc, tag)
          else
            Map.put(acc, tag, updated_entries)
          end
      end
    end)
  end

  defp remove_from_tag_index(tag_index, _tags, _key), do: tag_index

  defp generate_synthetic_deletes(stream, patterns) do
    # Collect all rows that match any of the move-out patterns
    {rows_to_delete, updated_tag_index} =
      Enum.reduce(patterns, {MapSet.new(), stream.tag_index}, fn %{value: tag_value}, {rows, tag_idx} ->
        case Map.pop(tag_idx, tag_value) do
          {nil, tag_idx} ->
            {rows, tag_idx}

          {entries, tag_idx} ->
            {MapSet.union(rows, entries), tag_idx}
        end
      end)

    # Generate synthetic delete messages for each row
    synthetic_deletes =
      rows_to_delete
      |> Enum.map(fn {key, original_msg} ->
        %Message.ChangeMessage{
          key: key,
          value: original_msg.value,
          old_value: original_msg.value,
          headers: Message.Headers.delete(
            relation: original_msg.headers.relation,
            handle: original_msg.headers.handle
          ),
          request_timestamp: DateTime.utc_now()
        }
      end)

    {synthetic_deletes, updated_tag_index}
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
