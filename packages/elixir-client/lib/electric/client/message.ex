defmodule Electric.Client.Message do
  @moduledoc false

  alias Electric.Client
  alias Electric.Client.Offset

  defmodule Headers do
    defstruct [:operation, :relation]

    @type operation :: :insert | :update | :delete
    @type relation :: [String.t(), ...]
    @type t :: %__MODULE__{operation: operation(), relation: relation()}

    @doc false
    def from_message(msg) do
      %{"operation" => operation} = msg
      %__MODULE__{relation: msg["relation"], operation: parse_operation(operation)}
    end

    defp parse_operation("insert"), do: :insert
    defp parse_operation("update"), do: :update
    defp parse_operation("delete"), do: :delete

    def insert(relation \\ nil), do: %__MODULE__{operation: :insert, relation: relation}
    def update(relation \\ nil), do: %__MODULE__{operation: :update, relation: relation}
    def delete(relation \\ nil), do: %__MODULE__{operation: :delete, relation: relation}
  end

  defmodule ControlMessage do
    defstruct [:control, :offset]
    @type control :: :must_refetch | :up_to_date
    @type t :: %__MODULE__{control: control(), offset: Offset.t()}

    def from_message(%{"headers" => %{"control" => control}}, offset) do
      %__MODULE__{control: control_atom(control), offset: offset}
    end

    defp control_atom("must-refetch"), do: :must_refetch
    defp control_atom("up-to-date"), do: :up_to_date

    def up_to_date, do: %__MODULE__{control: :up_to_date}
    def must_refetch, do: %__MODULE__{control: :must_refetch}
  end

  defmodule ChangeMessage do
    defstruct [:key, :value, :headers, :offset]

    @type key :: String.t()
    @type value :: %{String.t() => binary()}
    @type t :: %__MODULE__{
            key: key(),
            value: value(),
            headers: Headers.t(),
            offset: Offset.t()
          }

    require Logger

    def from_message(msg, value_mapping_fun) do
      %{
        "headers" => headers,
        "offset" => offset,
        "value" => raw_value
      } = msg

      value =
        try do
          value_mapping_fun.(raw_value)
        rescue
          exception ->
            Logger.error(
              "Unable to cast field values: #{Exception.format(:error, exception, __STACKTRACE__)}"
            )

            reraise exception, __STACKTRACE__
        end

      %__MODULE__{
        key: msg["key"],
        offset: Client.Offset.from_string!(offset),
        headers: Headers.from_message(headers),
        value: value
      }
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

    defstruct [:shape_handle, :offset, :schema]

    @type t :: %__MODULE__{
            shape_handle: Client.shape_handle(),
            offset: Offset.t(),
            schema: Client.schema()
          }
  end

  defguard is_insert(msg) when is_struct(msg, ChangeMessage) and msg.headers.operation == :insert

  def parse(%{"value" => _} = msg, _offset, value_mapper_fun) do
    [ChangeMessage.from_message(msg, value_mapper_fun)]
  end

  def parse(%{"headers" => %{"control" => _}} = msg, offset, _value_mapper_fun) do
    [ControlMessage.from_message(msg, offset)]
  end

  def parse("", _offset, _value_mapper_fun) do
    []
  end
end
