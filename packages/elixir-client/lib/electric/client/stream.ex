defmodule Electric.Client.Stream do
  @moduledoc false

  alias Electric.Client.Fetch
  alias Electric.Client.Message
  alias Electric.Client.Offset
  alias Electric.Client

  require Electric.Client.Offset

  defstruct [
    :client,
    :shape,
    :schema,
    :value_mapper_fun,
    parser: {Electric.Client.ValueMapper, []},
    buffer: :queue.new(),
    up_to_date?: false,
    update_mode: :modified,
    offset: Offset.before_all(),
    shape_handle: nil,
    next_cursor: nil,
    state: :init,
    opts: %{}
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
    update_mode: [
      type: {:in, [:full, :modified]},
      default: :modified,
      type_spec: quote(do: :modified | :full),
      doc:
        "Instructs the server to send just the changed columns for an update (`:modified`) or the full row (`:full`)."
    ],
    oneshot: [
      type: :boolean,
      default: false,
      doc: "Only make a single request and then terminate the stream."
    ],
    resume: [
      type: {:or, [nil, {:struct, Message.ResumeMessage}]},
      type_spec: quote(do: Message.ResumeMessage.t() | nil),
      doc: """
      Resume the stream from the given point. `Message.ResumeMessage` messages
      are appended to the change stream if you terminate it early using `live:
      false` or `oneshot: true`
      """
    ]
  ]
  @external_schema NimbleOptions.new!(@external_options)
  @schema NimbleOptions.new!(
            @external_options ++
              [
                client: [type: {:struct, Electric.Client}, required: true],
                shape: [type: {:struct, Electric.Client.ShapeDefinition}, required: true]
              ]
          )

  @opts_schema NimbleOptions.new!(
                 live: [type: :boolean, default: true],
                 resume: [type: {:struct, Message.ResumeMessage}],
                 oneshot: [type: :boolean, default: false]
               )

  @type opts :: %{
          live: boolean(),
          resume: nil | Message.ResumeMessage.t(),
          oneshot: boolean()
        }

  @type t :: %__MODULE__{
          client: Client.t(),
          shape: Client.ShapeDefinition.t(),
          schema: Client.schema(),
          value_mapper_fun: Client.ValueMapper.mapper_fun(),
          parser: nil | {module(), term()},
          buffer: :queue.queue(),
          up_to_date?: boolean(),
          offset: Offset.t(),
          update_mode: Client.update_mode(),
          shape_handle: nil | Client.shape_handle(),
          state: :init | :stream | :done,
          opts: opts()
        }

  alias __MODULE__, as: S

  def new(%Client{} = client, %Client.ShapeDefinition{} = shape, opts \\ []) do
    opts
    |> Keyword.put(:client, client)
    |> Keyword.put(:shape, shape)
    |> new()
  end

  def new(attrs) do
    {core, opts} =
      attrs
      |> NimbleOptions.validate!(@schema)
      |> Keyword.split([:client, :shape, :parser, :update_mode])

    opts = NimbleOptions.validate!(Map.new(opts), @opts_schema)

    struct(__MODULE__, Keyword.put(core, :opts, opts))
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

  defp handle_response(%Fetch.Response{status: status} = resp, stream)
       when status in 200..299 do
    start_offset = stream.offset
    shape_handle = shape_handle!(resp)
    final_offset = last_offset(resp, stream.offset)
    next_cursor = resp.next_cursor

    %{value_mapper_fun: value_mapper_fun} =
      stream =
      handle_schema(resp, %{stream | shape_handle: shape_handle, next_cursor: next_cursor})

    resp.body
    |> List.wrap()
    |> Enum.flat_map(&Message.parse(&1, final_offset, value_mapper_fun))
    |> Enum.reduce_while({start_offset, stream}, &handle_msg/2)
    # don't set the offset until we're done processing the messages. ehis keeps
    # the previous offset reached alive in the stream state
    |> then(fn {_offset, state} -> %{state | offset: final_offset} end)
    |> dispatch()
  end

  # 400: The request is invalid, most likely because the shape has been
  #      deleted. We should start from scratch, this will force the shape to be
  #      recreated
  # 409: Upon receiving a 409, we should start from scratch with the newly
  #      provided shape ID
  defp handle_response({:error, %Fetch.Response{status: status} = resp}, stream)
       when status in [400, 409] do
    %{value_mapper_fun: value_mapper_fun} = stream
    offset = last_offset(resp, stream.offset)

    stream
    |> reset(shape_handle(resp))
    |> buffer(Enum.flat_map(resp.body, &Message.parse(&1, offset, value_mapper_fun)))
    |> dispatch()
  end

  defp handle_response({:error, %Fetch.Response{} = resp}, _stream) do
    %Fetch.Response{body: body} = resp
    raise Client.Error, message: body, resp: resp
  end

  defp handle_response({:error, error}, _stream) do
    raise Client.Error, message: "Unable to retrieve data stream", resp: error
  end

  defp handle_msg(%Message.ControlMessage{control: :up_to_date} = msg, {offset, stream}) do
    handle_up_to_date(offset, %{stream | buffer: :queue.in(msg, stream.buffer), up_to_date?: true})
  end

  defp handle_msg(%Message.ChangeMessage{} = msg, {_offset, stream}) do
    {:cont, {msg.offset, %{stream | offset: msg.offset, buffer: :queue.in(msg, stream.buffer)}}}
  end

  defp handle_up_to_date(offset, %{opts: %{live: true}} = stream) do
    {:cont, {offset, stream}}
  end

  defp handle_up_to_date(offset, %{opts: %{live: false}} = stream) do
    resume_message = %Message.ResumeMessage{
      schema: stream.schema,
      offset: offset,
      shape_handle: stream.shape_handle
    }

    {:halt, {offset, %{stream | buffer: :queue.in(resume_message, stream.buffer), state: :done}}}
  end

  defp after_fetch({msgs, %{opts: %{oneshot: true}} = stream}) do
    resume_message = %Message.ResumeMessage{
      schema: stream.schema,
      offset: stream.offset,
      shape_handle: stream.shape_handle
    }

    {msgs, %{stream | buffer: :queue.in(resume_message, stream.buffer), state: :done}}
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
      client: client,
      shape: shape,
      up_to_date?: up_to_date?,
      update_mode: update_mode,
      shape_handle: shape_handle,
      offset: offset,
      next_cursor: cursor
    } = stream

    Client.request(client,
      offset: offset,
      shape_handle: shape_handle,
      update_mode: update_mode,
      live: up_to_date?,
      next_cursor: cursor,
      shape: shape
    )
  end

  defp make_request(stream) do
    stream
    |> build_request()
    |> make_request(stream)
  end

  defp make_request(request, stream) do
    Fetch.Request.request(stream.client, request)
  end

  defp reset(stream, shape_handle) do
    %{
      stream
      | offset: Offset.before_all(),
        shape_handle: shape_handle,
        up_to_date?: false,
        buffer: :queue.new(),
        schema: nil,
        value_mapper_fun: nil
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

  defp last_offset(%Fetch.Response{last_offset: %Offset{} = offset}, _offset) do
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
    {parser_module, parser_opts} = stream.parser || stream.shape.parser

    value_mapper_fun = parser_module.for_schema(schema, parser_opts)

    %{stream | schema: schema, value_mapper_fun: value_mapper_fun}
  end

  defp resume(%{opts: %{resume: %Message.ResumeMessage{} = resume}} = stream) do
    %{shape_handle: shape_handle, offset: offset, schema: schema} = resume

    generate_value_mapper(schema, %{stream | shape_handle: shape_handle, offset: offset})
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
