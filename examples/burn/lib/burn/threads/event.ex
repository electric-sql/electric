defmodule Burn.Threads.Event do
  use Ecto.Schema
  import Ecto.Changeset

  alias Burn.{
    Accounts,
    Threads
  }

  defmodule SystemData do
    use Ecto.Schema

    @primary_key false
    embedded_schema do
      field :action, Ecto.Enum, values: [:created, :joined, :left, :closed]
      field :target, Ecto.Enum, values: [:thread]
    end

    def changeset(text_data, attrs) do
      text_data
      |> cast(attrs, [:action, :target])
      |> validate_required([:action, :target])
    end
  end

  defmodule TextData do
    use Ecto.Schema

    @primary_key false
    embedded_schema do
      field :text, :string
    end

    def changeset(text_data, attrs) do
      text_data
      |> cast(attrs, [:text])
      |> validate_required([:text])
    end
  end

  defmodule ToolUseData do
    use Ecto.Schema

    @primary_key false
    embedded_schema do
      field :id, :string
      field :input, :map
      field :name, :string
    end

    def changeset(text_data, attrs) do
      text_data
      |> cast(attrs, [:id, :input, :name])
      |> validate_required([:id, :input, :name])
      |> validate_length(:name, min: 1, max: 200)
    end
  end

  defmodule ToolResultData do
    use Ecto.Schema

    @primary_key false
    embedded_schema do
      field :content, :string
      field :is_error, :boolean
      field :tool_name, :string
      field :tool_use_id, :string
    end

    def changeset(text_data, attrs) do
      text_data
      |> cast(attrs, [:content, :is_error, :tool_name, :tool_use_id])
      |> validate_required([:content, :is_error, :tool_name, :tool_use_id])
      |> validate_length(:tool_name, min: 1, max: 200)
    end
  end

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "events" do
    field :type, Ecto.Enum, values: [:system, :text, :tool_use, :tool_result]
    field :data, :map

    belongs_to :thread, Threads.Thread
    belongs_to :user, Accounts.User

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(event, attrs, user_type \\ nil)

  def changeset(event, attrs, user_type) when user_type in [:insert, :update, :delete] do
    changeset(event, attrs, nil)
  end

  def changeset(event, attrs, user_type) do
    event
    |> cast(attrs, [:id, :data, :type, :thread_id, :user_id])
    |> validate_required([:data, :type])
    |> validate_type()
    |> prepare_changes(&validate_user_type(&1, user_type))
    |> assoc_constraint(:thread)
    |> assoc_constraint(:user)
  end

  defp validate_type(changeset) do
    type = get_field(changeset, :type)

    schema_module =
      case type do
        :system -> SystemData
        :text -> TextData
        :tool_use -> ToolUseData
        :tool_result -> ToolResultData
        _alt -> nil
      end

    changeset
    |> validate_data(schema_module)
  end

  defp validate_data(changeset, nil) do
    changeset
    |> add_error(:data, "unable to perform conditional validation")
  end

  defp validate_data(changeset, schema_module) do
    data = get_field(changeset, :data)
    schema = struct(schema_module)

    case schema_module.changeset(schema, data) do
      %{valid?: true} ->
        changeset

      %{errors: errors} ->
        error_message =
          errors
          |> Enum.map(fn {field, {msg, _}} -> "#{field}: #{msg}" end)
          |> Enum.join("; ")

        changeset
        |> add_error(:data, "validation failed: #{error_message}")
    end
  end

  defp validate_user_type(changeset, nil) do
    user_id = get_field(changeset, :user_id)

    case Accounts.get_user(user_id) do
      %Accounts.User{type: user_type} ->
        validate_user_type(changeset, user_type)

      nil ->
        add_error(changeset, :user_id, "user can't be loaded")
    end
  end

  defp validate_user_type(changeset, user_type) when user_type in [:human, :agent] do
    event_type = get_field(changeset, :type)

    case validate_types_match(user_type, event_type) do
      :ok ->
        changeset

      {:error, :mismatch} ->
        changeset
        |> add_error(:type, "Can't be made by an: #{user_type}")
    end
  end

  defp validate_types_match(:human, :text), do: :ok
  defp validate_types_match(:agent, :tool_use), do: :ok
  defp validate_types_match(:agent, :tool_result), do: :ok
  defp validate_types_match(_user_type, :system), do: :ok
  defp validate_types_match(_user_type, _event_type), do: {:error, :mismatch}
end
