defmodule Electric.Entry do
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "entries" do
    field(:content, :string)
    field(:content_b, :string)
  end
end
