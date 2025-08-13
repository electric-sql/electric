defmodule Burn.Threads.Membership do
  use Ecto.Schema
  import Ecto.Changeset

  alias Burn.Accounts
  alias Burn.Threads

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "memberships" do
    field :role, Ecto.Enum, values: [:member, :owner, :producer, :comedian]

    belongs_to :thread, Threads.Thread
    belongs_to :user, Accounts.User

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(membership, attrs) do
    membership
    |> cast(attrs, [:id, :role, :thread_id, :user_id])
    |> validate_required([:role])
    |> assoc_constraint(:thread)
    |> assoc_constraint(:user)
  end
end
