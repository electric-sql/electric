defmodule Electric.Client.Poll do
  @moduledoc """
  Poll-based API for fetching shape changes.

  This module provides explicit request-response semantics for fetching
  changes from Electric, as an alternative to the streaming API.

  ## Usage

      # Create initial state
      state = ShapeState.new()

      # Make a polling request
      case Poll.request(client, state) do
        {:ok, messages, new_state} ->
          # Process messages, use new_state for next poll
          ...

        {:must_refetch, messages, new_state} ->
          # Shape was reset, clear local state and process messages
          ...

        {:error, error} ->
          # Handle error
          ...
      end

  ## Behavior

  - First request (when `up_to_date?: false`): Makes a non-live request to get initial snapshot
  - Subsequent requests (when `up_to_date?: true`): Makes a live request that long-polls until changes arrive
  - Handles synthetic deletes from move-out events
  - Returns updated state for the next request
  """

  alias Electric.Client
  alias Electric.Client.Fetch
  alias Electric.Client.Message
  alias Electric.Client.ShapeState
  alias Electric.Client.TagTracker

  @type poll_result ::
          {:ok, [Client.message()], ShapeState.t()}
          | {:must_refetch, [Client.message()], ShapeState.t()}
          | {:error, Client.Error.t()}

  @doc """
  Make a single polling request to fetch shape changes.

  ## Arguments

    * `client` - The Electric client
    * `shape` - The shape definition (or a client pre-configured for a shape)
    * `state` - The current polling state (use `ShapeState.new()` for initial request)
    * `opts` - Options:
      * `:replica` - `:default` or `:full` (default: `:default`)

  ## Returns

    * `{:ok, messages, new_state}` - Success, messages received
    * `{:must_refetch, messages, new_state}` - Shape was reset (409), state has been cleared
    * `{:error, error}` - Error occurred

  ## Examples

      state = ShapeState.new()
      {:ok, messages, state} = Poll.request(client, state, replica: :full)

      # Process messages...

      # Poll again for more changes
      {:ok, messages, state} = Poll.request(client, state, replica: :full)
  """
  @spec request(Client.t(), ShapeState.t(), keyword()) :: poll_result()
  def request(%Client{} = client, %ShapeState{} = state, opts \\ []) do
    replica = Keyword.get(opts, :replica, :default)

    request = build_request(client, state, replica)

    case Fetch.request(client, request) do
      %Fetch.Response{status: status} = resp when status in 200..299 ->
        handle_success(resp, client, state)

      {:error, %Fetch.Response{status: 409} = resp} ->
        handle_must_refetch(resp, client, state)

      {:error, %Fetch.Response{body: body} = resp} ->
        {:error, %Client.Error{message: unwrap_error(body), resp: resp}}

      {:error, error} ->
        {:error, %Client.Error{message: "Unable to retrieve data", resp: error}}
    end
  end

  defp build_request(client, state, replica) do
    %{
      shape_handle: shape_handle,
      offset: offset,
      up_to_date?: up_to_date?,
      next_cursor: cursor
    } = state

    Client.request(client,
      offset: offset,
      shape_handle: shape_handle,
      replica: replica,
      live: up_to_date?,
      next_cursor: cursor
    )
  end

  defp handle_success(resp, client, state) do
    shape_handle = shape_handle!(resp)
    final_offset = last_offset(resp, state.offset)
    next_cursor = resp.next_cursor

    state = %{state | shape_handle: shape_handle, next_cursor: next_cursor, offset: final_offset}
    state = handle_schema(resp, client, state)

    %{value_mapper_fun: value_mapper_fun} = state

    {messages, new_state} =
      resp.body
      |> ensure_enum()
      |> Enum.flat_map(&Message.parse(&1, shape_handle, value_mapper_fun, resp.request_timestamp))
      |> process_messages(state)

    {:ok, messages, new_state}
  end

  defp handle_must_refetch(resp, client, state) do
    handle = shape_handle(resp) || "#{state.shape_handle}-next"

    new_state = ShapeState.reset(state, handle)
    new_state = handle_schema(resp, client, new_state)

    %{value_mapper_fun: value_mapper_fun} = new_state

    messages =
      resp.body
      |> ensure_enum()
      |> Enum.flat_map(&Message.parse(&1, handle, value_mapper_fun, resp.request_timestamp))

    {:must_refetch, messages, new_state}
  end

  defp process_messages(messages, state) do
    {processed_messages, new_state} =
      Enum.reduce(messages, {[], state}, fn msg, {msgs_acc, state_acc} ->
        case handle_message(msg, state_acc) do
          {:message, processed_msg, new_state} ->
            {[processed_msg | msgs_acc], new_state}

          {:messages, processed_msgs, new_state} ->
            {Enum.reverse(processed_msgs) ++ msgs_acc, new_state}

          {:skip, new_state} ->
            {msgs_acc, new_state}
        end
      end)

    {Enum.reverse(processed_messages), new_state}
  end

  defp handle_message(%Message.ControlMessage{control: :up_to_date} = msg, state) do
    {:message, msg, %{state | up_to_date?: true}}
  end

  defp handle_message(%Message.ControlMessage{control: :snapshot_end}, state) do
    {:skip, state}
  end

  defp handle_message(%Message.ChangeMessage{} = msg, state) do
    {tag_to_keys, key_data} =
      TagTracker.update_tag_index(state.tag_to_keys, state.key_data, msg)

    {:message, msg, %{state | tag_to_keys: tag_to_keys, key_data: key_data}}
  end

  defp handle_message(
         %Message.MoveOutMessage{patterns: patterns, request_timestamp: request_timestamp},
         state
       ) do
    {synthetic_deletes, tag_to_keys, key_data} =
      TagTracker.generate_synthetic_deletes(
        state.tag_to_keys,
        state.key_data,
        patterns,
        request_timestamp
      )

    {:messages, synthetic_deletes, %{state | tag_to_keys: tag_to_keys, key_data: key_data}}
  end

  defp handle_schema(%Fetch.Response{schema: schema}, client, %{value_mapper_fun: nil} = state)
       when is_map(schema) do
    {parser_module, parser_opts} = client.parser
    value_mapper_fun = parser_module.for_schema(schema, parser_opts)

    %{state | schema: schema, value_mapper_fun: value_mapper_fun}
  end

  defp handle_schema(_resp, _client, state) do
    state
  end

  defp ensure_enum(body) do
    case Enumerable.impl_for(body) do
      nil -> List.wrap(body)
      Enumerable.Map -> List.wrap(body)
      _impl -> body
    end
  end

  defp shape_handle!(resp) do
    shape_handle(resp) ||
      raise Client.Error, message: "Missing electric-handle header", resp: resp
  end

  defp shape_handle(%Fetch.Response{shape_handle: shape_handle}) do
    shape_handle
  end

  defp last_offset(%Fetch.Response{last_offset: nil}, offset), do: offset
  defp last_offset(%Fetch.Response{last_offset: offset}, _offset), do: offset

  defp unwrap_error([]), do: "Unknown error"
  defp unwrap_error([msg]), do: msg
  defp unwrap_error([_ | _] = msgs), do: msgs
  defp unwrap_error(msg), do: msg
end
