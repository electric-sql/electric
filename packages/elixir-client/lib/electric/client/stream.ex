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
    stream = update_tag_index(stream, msg)
    {:cont, %{stream | buffer: :queue.in(msg, stream.buffer)}}
  end

  defp handle_msg(
         %Message.MoveOutMessage{patterns: patterns, request_timestamp: request_timestamp} = _msg,
         stream
       ) do
    # Assumption: move-out events are only emitted after the initial snapshot is complete.
    # We therefore apply them immediately and do not buffer for later inserts.

    # Generate synthetic deletes for rows matching the move-out patterns
    {synthetic_deletes, updated_tag_to_keys, updated_key_data} =
      generate_synthetic_deletes(stream, patterns, request_timestamp)

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
        key_data: key_data
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

  # Tag index management for move-out support
  #
  # We maintain two data structures:
  # - tag_to_keys: %{tag_value => MapSet<key>} - which keys have each tag
  # - key_data: %{key => %{tags: MapSet<tag>, msg: msg}} - each key's current tags and latest message
  #
  # This allows us to:
  # 1. Avoid duplicate entries when a row is updated (we update the msg, not add a new entry)
  # 2. Check if a row still has other tags before generating a synthetic delete

  defp update_tag_index(stream, %Message.ChangeMessage{headers: headers, key: key} = msg) do
    %{tag_to_keys: tag_to_keys, key_data: key_data} = stream
    new_tags = headers.tags || []
    removed_tags = headers.removed_tags || []

    # Get current data for this key
    current_data = Map.get(key_data, key)
    current_tags = if current_data, do: current_data.tags, else: MapSet.new()

    # Calculate the new set of tags for this key
    updated_tags =
      current_tags
      |> MapSet.difference(MapSet.new(removed_tags))
      |> MapSet.union(MapSet.new(new_tags))

    # For deletes, remove the key entirely
    {_final_tags, final_key_data, final_tag_to_keys} =
      case headers.operation do
        :delete ->
          # Remove key from all its tags in tag_to_keys
          updated_tag_to_keys =
            Enum.reduce(MapSet.to_list(updated_tags), tag_to_keys, fn tag, acc ->
              remove_key_from_tag(acc, tag, key)
            end)

          # Remove key from key_data
          {MapSet.new(), Map.delete(key_data, key), updated_tag_to_keys}

        _ ->
          # If no tags (current or new), don't track this key
          if MapSet.size(updated_tags) == 0 do
            # Remove key from all its previous tags in tag_to_keys
            updated_tag_to_keys =
              Enum.reduce(MapSet.to_list(current_tags), tag_to_keys, fn tag, acc ->
                remove_key_from_tag(acc, tag, key)
              end)

            # Remove key from key_data
            {MapSet.new(), Map.delete(key_data, key), updated_tag_to_keys}
          else
            # Update tag_to_keys: remove from old tags, add to new tags
            tags_to_remove = MapSet.difference(current_tags, updated_tags)
            tags_to_add = MapSet.difference(updated_tags, current_tags)

            updated_tag_to_keys =
              tag_to_keys
              |> remove_key_from_tags(tags_to_remove, key)
              |> add_key_to_tags(tags_to_add, key)

            # Update key_data with new tags and latest message
            updated_key_data = Map.put(key_data, key, %{tags: updated_tags, msg: msg})

            {updated_tags, updated_key_data, updated_tag_to_keys}
          end
      end

    %{stream | tag_to_keys: final_tag_to_keys, key_data: final_key_data}
  end

  defp remove_key_from_tags(tag_to_keys, tags, key) do
    Enum.reduce(MapSet.to_list(tags), tag_to_keys, fn tag, acc ->
      remove_key_from_tag(acc, tag, key)
    end)
  end

  defp remove_key_from_tag(tag_to_keys, tag, key) do
    case Map.get(tag_to_keys, tag) do
      nil ->
        tag_to_keys

      keys ->
        updated_keys = MapSet.delete(keys, key)

        if MapSet.size(updated_keys) == 0 do
          Map.delete(tag_to_keys, tag)
        else
          Map.put(tag_to_keys, tag, updated_keys)
        end
    end
  end

  defp add_key_to_tags(tag_to_keys, tags, key) do
    Enum.reduce(MapSet.to_list(tags), tag_to_keys, fn tag, acc ->
      keys = Map.get(acc, tag, MapSet.new())
      Map.put(acc, tag, MapSet.put(keys, key))
    end)
  end

  defp generate_synthetic_deletes(stream, patterns, request_timestamp) do
    %{tag_to_keys: tag_to_keys, key_data: key_data} = stream

    # Assumption: move-out patterns only include simple tag values; positional matching
    # for composite tags is not needed with the current server behavior.

    # First pass: collect all keys that match any pattern and remove those tags
    {matched_keys_with_tags, updated_tag_to_keys} =
      Enum.reduce(patterns, {%{}, tag_to_keys}, fn %{value: tag_value}, {keys_acc, ttk_acc} ->
        case Map.pop(ttk_acc, tag_value) do
          {nil, ttk_acc} ->
            {keys_acc, ttk_acc}

          {keys_in_tag, ttk_acc} ->
            # Track which tags were removed for each key
            updated_keys_acc =
              Enum.reduce(keys_in_tag, keys_acc, fn key, acc ->
                removed_tags = Map.get(acc, key, MapSet.new())
                Map.put(acc, key, MapSet.put(removed_tags, tag_value))
              end)

            {updated_keys_acc, ttk_acc}
        end
      end)

    # Second pass: for each matched key, update its tags and check if it should be deleted
    {keys_to_delete, updated_key_data} =
      Enum.reduce(matched_keys_with_tags, {[], key_data}, fn {key, removed_tags},
                                                             {deletes, kd_acc} ->
        case Map.get(kd_acc, key) do
          nil ->
            {deletes, kd_acc}

          %{tags: current_tags, msg: msg} ->
            remaining_tags = MapSet.difference(current_tags, removed_tags)

            if MapSet.size(remaining_tags) == 0 do
              # No remaining tags - key should be deleted
              {[{key, msg} | deletes], Map.delete(kd_acc, key)}
            else
              # Still has other tags - update key_data but don't delete
              {deletes, Map.put(kd_acc, key, %{tags: remaining_tags, msg: msg})}
            end
        end
      end)

    # Generate synthetic delete messages
    synthetic_deletes =
      Enum.map(keys_to_delete, fn {key, original_msg} ->
        %Message.ChangeMessage{
          key: key,
          value: original_msg.value,
          old_value: nil,
          headers:
            Message.Headers.delete(
              relation: original_msg.headers.relation,
              handle: original_msg.headers.handle
            ),
          request_timestamp: request_timestamp
        }
      end)

    {synthetic_deletes, updated_tag_to_keys, updated_key_data}
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
