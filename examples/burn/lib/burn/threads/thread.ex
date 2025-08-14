defmodule Burn.Threads.Thread do
  use Ecto.Schema
  import Ecto.Changeset

  alias Burn.Accounts
  alias Burn.Threads

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "threads" do
    field :name, :string
    field :status, Ecto.Enum, values: [:started, :cancelled, :completed]

    has_many :events, Threads.Event
    many_to_many :users, Accounts.User, join_through: Threads.Membership

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(thread, attrs) do
    thread
    |> cast(attrs, [:id, :name, :status])
    |> validate_required([:name, :status])
  end
end
