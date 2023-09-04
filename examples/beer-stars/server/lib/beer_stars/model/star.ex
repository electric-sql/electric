defmodule BeerStars.Model.Star do
  use Ecto.Schema
  import Ecto.Changeset
  alias BeerStars.Model

  @fields [
    :avatar_url,
    :id,
    :name,
    :starred_at,
    :username
  ]

  @optional [
    :name
  ]
  @required Enum.reject(@fields, &Enum.member?(@optional, &1))

  # The ID is a hash of the GitHub
  @primary_key {:id, :string, autogenerate: false}
  @foreign_key_type :string
  schema "stars" do
    field :avatar_url, :string
    field :name, :string
    field :starred_at, :string
    field :username, :string

    has_many :beers, Model.Beer
  end

  @doc false
  def changeset(star, attrs) do
    star
    |> cast(attrs, @fields)
    |> validate_required(@required)
  end
end
