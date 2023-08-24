defmodule BeerStars.Model.Beer do
  use Ecto.Schema
  import Ecto.Changeset
  alias BeerStars.Model

  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string
  schema "beers" do
    belongs_to :star, Model.Star
  end

  @doc false
  def changeset(beer, attrs \\ %{}) do
    beer
    |> cast(attrs, [:id, :star_id])
    |> validate_required([])
  end
end
