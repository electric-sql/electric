defmodule Burn.Memory.Fact do
  use Ecto.Schema
  import Ecto.Changeset

  alias Burn.Accounts
  alias Burn.Threads

  def fact_field_names,
    do: [
      :predicate,
      :object,
      :category,
      :confidence,
      :disputed
    ]

  def required_fact_field_names,
    do: [
      :predicate,
      :object,
      :category
    ]

  # Used by `Burn.Tools.ExtractFacts`.
  defmodule Embedded do
    use Ecto.Schema

    @primary_key false
    embedded_schema do
      field :source_event, :binary_id
      field :subject, :binary_id

      field :predicate, :string
      field :object, :string
      field :category, :string
      field :confidence, :decimal
      field :disputed, :boolean
    end
  end

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "facts" do
    belongs_to :thread, Threads.Thread
    belongs_to :source_event, Threads.Event
    belongs_to :tool_use_event, Threads.Event
    belongs_to :subject, Accounts.User

    field :predicate, :string
    field :object, :string
    field :category, :string
    field :confidence, :decimal
    field :disputed, :boolean

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(fact, attrs) do
    fact
    |> cast(attrs, [:id, :source_event_id, :subject_id, :thread_id, :tool_use_event_id])
    |> validate_required([:source_event_id, :subject_id, :thread_id, :tool_use_event_id])
    |> validate_fact_fields(attrs)
    |> assoc_constraint(:thread)
    |> assoc_constraint(:source_event)
    |> assoc_constraint(:tool_use_event)
    |> assoc_constraint(:subject)
  end

  def validate_fact_fields(changeset, attrs) do
    changeset
    |> cast(attrs, fact_field_names())
    |> validate_required(required_fact_field_names())
    |> validate_number(:confidence,
      greater_than: Decimal.new("0.0"),
      less_than_or_equal_to: Decimal.new("1.0")
    )
  end
end
