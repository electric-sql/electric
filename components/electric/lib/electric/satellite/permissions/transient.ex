defmodule Electric.Satellite.Permissions.Transient do
  use GenServer

  alias Electric.Satellite.Permissions
  alias Electric.Postgres.Lsn

  defstruct [:id, :assign_id, :scope_id, :target_relation, :target_id, :valid_to]

  @type relation() :: Electric.Postgres.relation()
  @type t() :: %__MODULE__{
          id: binary(),
          assign_id: binary(),
          scope_id: binary(),
          target_relation: relation(),
          target_id: binary(),
          valid_to: Electric.Postgres.Lsn.t()
        }

  def new(attrs) do
    struct(__MODULE__, attrs)
  end

  @spec for_roles([Permissions.Role.t()], atom()) :: [t()]
  def for_roles(roles, lsn, name \\ __MODULE__) do
    roles
    |> Stream.flat_map(&filter_for_role/1)
    |> Stream.flat_map(&apply_filter(&1, name))
    |> Enum.filter(&filter_expired(&1, lsn))
  end

  @spec update([t()], atom) :: :ok
  def update(permissions, name \\ __MODULE__) do
    permissions
    |> Enum.map(&entry_for_permission/1)
    |> then(&:ets.insert(name, &1))

    :ok
  end

  defp entry_for_permission(%__MODULE__{} = permission) do
    %{assign_id: assign_id, scope_id: scope_id} = permission
    {assign_id, scope_id, permission}
  end

  defp filter_for_role(%Permissions.Role{assign_id: assign_id, scope: {_, scope_id}} = _role) do
    [{assign_id, scope_id, :"$1"}]
  end

  defp apply_filter(match, table) do
    table
    |> :ets.match(match)
    |> Stream.map(fn [m] -> m end)
  end

  defp filter_expired(%__MODULE__{valid_to: expires_lsn}, change_lsn) do
    Lsn.compare(expires_lsn, change_lsn) in [:gt, :eq]
  end

  def start_link(attrs \\ []) do
    name = Keyword.get(attrs, :name, __MODULE__)
    GenServer.start_link(__MODULE__, name, name: name)
  end

  def init(name) do
    table = :ets.new(name, [:bag, :public, :named_table, read_concurrency: true])
    # TODO: boot and load all existing transient permissions
    {:ok, table}
  end
end
