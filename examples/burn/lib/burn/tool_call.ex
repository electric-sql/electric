defmodule Burn.ToolCall do
  use Ecto.Schema
  import Ecto.Changeset

  alias Burn.{
    Threads,
    Types
  }

  @primary_key false
  embedded_schema do
    field :id, :string
    field :input, :map
    field :name, :string

    field :thread_id, :binary_id
    field :tool_module, Types.ExistingAtom
  end

  def validate(%Threads.Thread{id: thread_id}, attrs, tool_modules) do
    %__MODULE__{}
    |> cast(%{thread_id: thread_id}, [:thread_id])
    |> changeset(attrs, tool_modules)
  end

  def changeset(tool_call, attrs, tool_modules) do
    tool_call
    |> cast(attrs, [:id, :input, :name])
    |> validate_required([:id, :input, :name])
    |> validate_length(:name, min: 1, max: 200)
    |> validate_tool(tool_modules)
  end

  defp validate_tool(changeset, tool_modules) do
    name = get_field(changeset, :name)

    case Enum.find(tool_modules, fn mod -> mod.name() == name end) do
      nil ->
        changeset
        |> add_error(:name, "tool not found: #{name}")

      tool_module ->
        changeset
        |> validate_input(tool_module)
    end
  end

  defp validate_input(changeset, tool_module) do
    tool_call = apply_changes(changeset)
    tool = struct(tool_module)
    input = get_field(changeset, :input)

    case tool_module.validate(tool_call, tool, input) do
      %{valid?: true} ->
        changeset
        |> cast(%{tool_module: tool_module}, [:tool_module])

      %{errors: errors} = changeset ->
        error_message =
          errors
          |> Enum.map(fn {field, {msg, _}} -> "#{field}: #{msg}" end)
          |> Enum.join("; ")

        changeset
        |> add_error(:input, "validation failed: #{error_message}")
    end
  end

  @doc """
  Validate that a user is in the current thread.
  """
  @spec validate_user_in_thread(Ecto.Changeset.t(), atom(), binary()) :: Ecto.Changeset.t()
  def validate_user_in_thread(changeset, field, thread_id) do
    changeset
    |> validate_change(field, fn ^field, user_id ->
      case Threads.is_member?(thread_id, user_id) do
        true -> []
        false -> [{field, "user is not a member of this thread"}]
      end
    end)
  end

  @doc """
  Validate that an event is in the current thread.
  """
  @spec validate_event_in_thread(Ecto.Changeset.t(), atom(), binary()) :: Ecto.Changeset.t()
  def validate_event_in_thread(changeset, field, thread_id) do
    changeset
    |> validate_change(field, fn ^field, event_id ->
      case Threads.event_in_thread?(thread_id, event_id) do
        true -> []
        false -> [{field, "event isn't in this thread"}]
      end
    end)
  end

  @doc """
  Convert to a map that can be stored in the `Threads.Event` `:data` field.
  """
  def to_event_data(%__MODULE__{id: id, input: input, name: name}) do
    %{id: id, input: input, name: name}
  end
end
