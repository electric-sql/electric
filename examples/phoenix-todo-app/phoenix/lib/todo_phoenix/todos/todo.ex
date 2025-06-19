defmodule TodoPhoenix.Todos.Todo do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "todos" do
    field :title, :string
    field :completed, :boolean, default: false

    timestamps(type: :utc_datetime_usec)
  end

  @doc """
  Changeset for creating/updating todos.
  Client sends UUID for id, title is required.
  """
  def changeset(todo, attrs) do
    todo
    |> cast(attrs, [:id, :title, :completed])
    |> validate_required([:title])
    |> validate_length(:title, min: 1, max: 500)
    |> validate_uuid_format(:id)
    |> maybe_generate_id()
  end

  defp validate_uuid_format(changeset, field) do
    validate_change(changeset, field, fn field, value ->
      case Ecto.UUID.cast(value) do
        {:ok, _} -> []
        :error -> [{field, "must be a valid UUID"}]
      end
    end)
  end

  defp maybe_generate_id(changeset) do
    case get_field(changeset, :id) do
      nil -> put_change(changeset, :id, Ecto.UUID.generate())
      _ -> changeset
    end
  end
end
