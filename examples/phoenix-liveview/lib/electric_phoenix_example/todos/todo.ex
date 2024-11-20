defmodule Electric.PhoenixExample.Todos.Todo do
  use Ecto.Schema
  import Ecto.Changeset

  schema "todos" do
    field :text, :string
    field :completed, :boolean, default: false

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(todo, attrs) do
    todo
    |> cast(attrs, [:text, :completed])
    |> validate_required([:text, :completed])
    |> update_change(:text, &String.trim/1)
  end
end
