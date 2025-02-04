defmodule Support.User do
  use Ecto.Schema

  @primary_key {:id, :binary_id, []}

  schema "users" do
    field(:name, :string)
    field(:visible, :boolean)
    field(:age, :integer)
  end
end
