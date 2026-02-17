defmodule Electric.Client.Message do
  @moduledoc false

  alias Electric.Client
  alias Electric.Client.Offset

  defmodule Headers do
    defstruct [
      :operation,
      :relation,
      :handle,
      :lsn,
      txids: [],
      op_position: 0,
      tags: [],
      removed_tags: [],
      active_conditions: []
    ]

    @type operation :: :insert | :update | :delete
    @type relation :: [String.t(), ...]
    @type lsn :: binary()
    @type txids :: [pos_integer(), ...] | nil
    @type tag :: String.t()
    @type t :: %__MODULE__{
            operation: operation(),
            relation: relation(),
            handle: Client.shape_handle(),
            lsn: lsn(),
            txids: txids(),
            op_position: non_neg_integer(),
            tags: [tag()],
            removed_tags: [tag()],
            active_conditions: [boolean()]
          }

    @doc false
    def from_message(msg, handle) do
      %{"operation" => operation} = msg

      %__MODULE__{
        relation: Map.get(msg, "relation"),
        operation: parse_operation(operation),
        handle: handle,
        txids: Map.get(msg, "txids", []),
        lsn: Map.get(msg, "lsn", nil),
        op_position: Map.get(msg, "op_position", 0),
        tags: Map.get(msg, "tags", []),
        removed_tags: Map.get(msg, "removed_tags", []),
        active_conditions: Map.get(msg, "active_conditions", [])
      }
    end

    defp parse_operation("insert"), do: :insert
    defp parse_operation("update"), do: :update
    defp parse_operation("delete"), do: :delete

    def insert(opts \\ []), do: struct(%__MODULE__{operation: :insert}, opts)
    def update(opts \\ []), do: struct(%__MODULE__{operation: :update}, opts)
    def delete(opts \\ []), do: struct(%__MODULE__{operation: :delete}, opts)
  end

  defmodule ControlMessage do
    defstruct [:control, :global_last_seen_lsn, :handle, :request_timestamp]

    @type control :: :must_refetch | :up_to_date
    @type t :: %__MODULE__{
            control: control(),
            global_last_seen_lsn: pos_integer(),
            handle: Client.shape_handle(),
            request_timestamp: DateTime.t()
          }

    def from_message(
          %{"headers" => %{"control" => control} = headers},
          handle,
          request_timestamp
        ) do
      %__MODULE__{
        control: control_atom(control),
        global_last_seen_lsn: global_last_seen_lsn(headers),
        handle: handle,
        request_timestamp: request_timestamp
      }
    end

    def from_message(
          %{headers: %{control: control} = headers},
          handle,
          request_timestamp
        ) do
      %__MODULE__{
        control: control_atom(control),
        global_last_seen_lsn: global_last_seen_lsn(headers),
        handle: handle,
        request_timestamp: request_timestamp
      }
    end

    defp control_atom("must-refetch"), do: :must_refetch
    defp control_atom("up-to-date"), do: :up_to_date
    defp control_atom("snapshot-end"), do: :snapshot_end
    defp control_atom(a) when is_atom(a), do: a

    defp global_last_seen_lsn(headers) do
      parse_lsn(headers["global_last_seen_lsn"] || headers[:global_last_seen_lsn])
    end

    defp parse_lsn(nil), do: nil
    defp parse_lsn(lsn) when is_binary(lsn), do: String.to_integer(lsn)
    defp parse_lsn(lsn) when is_integer(lsn), do: lsn

    def up_to_date, do: %__MODULE__{control: :up_to_date}
    def must_refetch, do: %__MODULE__{control: :must_refetch}
  end

  defmodule ChangeMessage do
    defstruct [:key, :value, :old_value, :headers, :request_timestamp]

    @type key :: String.t()
    @type value :: %{String.t() => binary()}
    @type t :: %__MODULE__{
            key: key(),
            value: value(),
            old_value: nil | value(),
            headers: Headers.t(),
            request_timestamp: DateTime.t()
          }

    require Logger

    def from_message(msg, handle, value_mapping_fun, request_timestamp) do
      %{
        "headers" => headers,
        "value" => raw_value
      } = msg

      value = map_values(raw_value, value_mapping_fun)

      %__MODULE__{
        key: msg["key"],
        headers: Headers.from_message(headers, handle),
        value: value,
        old_value: old_value(msg, value_mapping_fun),
        request_timestamp: request_timestamp
      }
    end

    defp old_value(%{"old_value" => old_value}, value_mapping_fun) when is_map(old_value) do
      map_values(old_value, value_mapping_fun)
    end

    defp old_value(_msg, _value_mapping_fun), do: nil

    @compile {:inline, map_values: 2}

    defp map_values(raw_value, value_mapping_fun) do
      try do
        value_mapping_fun.(raw_value)
      rescue
        exception ->
          Logger.error(
            "Unable to cast field values: #{Exception.format(:error, exception, __STACKTRACE__)}"
          )

          reraise exception, __STACKTRACE__
      end
    end
  end

  defmodule ResumeMessage do
    @moduledoc """
    Emitted by the synchronisation stream before terminating early. If passed
    as an option to [`Client.stream/3`](`Electric.Client.stream/3`) allows for
    resuming a shape stream at the given point.

    E.g.

    ```
    # passing `live: false` means the stream will terminate once it receives an
    # `up-to-date` message from the server
    messages = Electric.Client.stream(client, "my_table", live: false) |> Enum.to_list()

    %ResumeMessage{} = resume = List.last(messages)

    # `stream` will resume from whatever point the initial one finished
    stream = Electric.Client.stream(client, "my_table", resume: resume)
    ```
    """

    @enforce_keys [:shape_handle, :offset, :schema]

    defstruct [:shape_handle, :offset, :schema, tag_to_keys: %{}, key_data: %{}]

    @type t :: %__MODULE__{
            shape_handle: Client.shape_handle(),
            offset: Offset.t(),
            schema: Client.schema(),
            tag_to_keys: %{optional(term()) => MapSet.t(String.t())},
            key_data: %{optional(String.t()) => map()}
          }
  end

  defmodule MoveOutMessage do
    @moduledoc """
    Represents a move-out event from the server.

    Move-out events are sent when rows should be removed from the client's view
    because they no longer match the shape's subquery filter. The `patterns` field
    contains tag hashes that identify which rows should be removed.

    The client should use these patterns to generate synthetic delete messages
    for any tracked rows that have matching tags.
    """

    defstruct [:patterns, :handle, :request_timestamp]

    @type pattern :: %{pos: non_neg_integer(), value: String.t()}
    @type t :: %__MODULE__{
            patterns: [pattern()],
            handle: Client.shape_handle(),
            request_timestamp: DateTime.t()
          }

    def from_message(
          %{"headers" => %{"event" => "move-out", "patterns" => patterns}},
          handle,
          request_timestamp
        ) do
      %__MODULE__{
        patterns: normalize_patterns(patterns),
        handle: handle,
        request_timestamp: request_timestamp
      }
    end

    def from_message(
          %{headers: %{event: "move-out", patterns: patterns}},
          handle,
          request_timestamp
        ) do
      %__MODULE__{
        patterns: normalize_patterns(patterns),
        handle: handle,
        request_timestamp: request_timestamp
      }
    end

    defp normalize_patterns(patterns) do
      Enum.map(patterns, fn
        %{"pos" => pos, "value" => value} -> %{pos: pos, value: value}
        %{pos: _, value: _} = pattern -> pattern
      end)
    end
  end

  defguard is_insert(msg) when is_struct(msg, ChangeMessage) and msg.headers.operation == :insert

  def parse(%{"value" => _} = msg, shape_handle, value_mapper_fun, request_timestamp) do
    [ChangeMessage.from_message(msg, shape_handle, value_mapper_fun, request_timestamp)]
  end

  def parse(
        %{"headers" => %{"control" => _}} = msg,
        shape_handle,
        _value_mapper_fun,
        request_timestamp
      ) do
    [ControlMessage.from_message(msg, shape_handle, request_timestamp)]
  end

  def parse(%{headers: %{control: _}} = msg, shape_handle, _value_mapper_fun, request_timestamp) do
    [ControlMessage.from_message(msg, shape_handle, request_timestamp)]
  end

  def parse(
        %{"headers" => %{"event" => "move-out"}} = msg,
        shape_handle,
        _value_mapper_fun,
        request_timestamp
      ) do
    [MoveOutMessage.from_message(msg, shape_handle, request_timestamp)]
  end

  def parse(
        %{headers: %{event: "move-out"}} = msg,
        shape_handle,
        _value_mapper_fun,
        request_timestamp
      ) do
    [MoveOutMessage.from_message(msg, shape_handle, request_timestamp)]
  end

  def parse("", _handle, _value_mapper_fun, _request_timestamp) do
    []
  end
end
