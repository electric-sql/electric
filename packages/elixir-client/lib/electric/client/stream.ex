defmodule Electric.Client.Stream do
  @moduledoc false

  alias Electric.Client.Message
  alias Electric.Client.Poll
  alias Electric.Client.ShapeState
  alias Electric.Client

  defstruct [
    :id,
    :client,
    :poll_state,
    parser: {Electric.Client.ValueMapper, []},
    buffer: :queue.new(),
    replica: :default,
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
          poll_state: ShapeState.t(),
          parser: nil | {module(), term()},
          buffer: :queue.queue(),
          replica: Client.replica(),
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
    poll_state = ShapeState.new()

    struct(__MODULE__, Keyword.merge(core, id: id, opts: opts, poll_state: poll_state))
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
    |> maybe_resume()
    |> Map.put(:state, :stream)
    |> fetch()
  end

  defp fetch(%S{} = stream) do
    # Use the parser from stream config or fall back to client's parser
    parser = stream.parser || stream.client.parser
    client_with_parser = %{stream.client | parser: parser}

    case Poll.request(client_with_parser, stream.poll_state, replica: stream.replica) do
      {:ok, messages, new_poll_state} ->
        stream
        |> Map.put(:poll_state, new_poll_state)
        |> handle_messages(messages)
        |> dispatch()

      {:must_refetch, messages, new_poll_state} ->
        stream
        |> Map.put(:poll_state, new_poll_state)
        |> Map.put(:buffer, :queue.new())
        |> handle_messages(messages)
        |> dispatch()

      {:error, error} ->
        handle_error(error, stream)
    end
  end

  defp handle_messages(stream, messages) do
    Enum.reduce_while(messages, stream, &handle_msg/2)
  end

  defp handle_msg(%Message.ControlMessage{control: :up_to_date} = msg, stream) do
    handle_up_to_date(%{stream | buffer: :queue.in(msg, stream.buffer)})
  end

  defp handle_msg(%Message.ControlMessage{control: :must_refetch} = msg, stream) do
    {:cont, %{stream | buffer: :queue.in(msg, stream.buffer)}}
  end

  defp handle_msg(%Message.ControlMessage{control: :snapshot_end}, stream) do
    {:cont, stream}
  end

  defp handle_msg(%Message.ChangeMessage{} = msg, stream) do
    {:cont, %{stream | buffer: :queue.in(msg, stream.buffer)}}
  end

  defp handle_msg(%Client.Error{} = error, stream) do
    # Errors from Poll are passed through as messages
    {:cont, %{stream | buffer: :queue.in(error, stream.buffer), state: :done}}
  end

  defp handle_msg(_other, stream) do
    {:cont, stream}
  end

  defp handle_up_to_date(%{opts: %{live: true}} = stream) do
    {:cont, stream}
  end

  defp handle_up_to_date(%{opts: %{live: false}} = stream) do
    resume_message = ShapeState.to_resume(stream.poll_state)
    {:halt, %{stream | buffer: :queue.in(resume_message, stream.buffer), state: :done}}
  end

  defp handle_error(error, %{opts: %{errors: :stream}} = stream) do
    %{stream | buffer: :queue.in(error, stream.buffer), state: :done}
    |> dispatch()
  end

  defp handle_error(error, _stream) do
    raise error
  end

  defp dispatch(%{buffer: buffer} = stream) do
    case :queue.out(buffer) do
      {{:value, elem}, buffer} -> {[elem], %{stream | buffer: buffer}}
      {:empty, buffer} -> {[], %{stream | buffer: buffer}}
    end
  end

  defp maybe_resume(%{opts: %{resume: %Message.ResumeMessage{} = resume}} = stream) do
    poll_state = ShapeState.from_resume(resume)

    # If the resume message includes a schema, generate the value mapper
    # so that subsequent responses (which won't include schema) can parse values
    poll_state =
      if poll_state.schema && is_nil(poll_state.value_mapper_fun) do
        {parser_module, parser_opts} = stream.parser || stream.client.parser
        value_mapper_fun = parser_module.for_schema(poll_state.schema, parser_opts)
        %{poll_state | value_mapper_fun: value_mapper_fun}
      else
        poll_state
      end

    %{stream | poll_state: poll_state}
  end

  defp maybe_resume(stream) do
    stream
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
