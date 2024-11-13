defmodule Api.Item do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "items" do
    field :value, :string
  end

  @doc false
  def changeset(item, attrs) do
    item
    |> cast(attrs, [:value])
  end
end
