defmodule Electric.Satellite.Permissions.Transient do
  use GenServer

  alias Electric.Satellite.{Permissions, Permissions.RoleGrant}
  alias Electric.Postgres.Lsn

  defstruct [:id, :assign_id, :scope_id, :target_relation, :target_id, :valid_to]

  @type tid() :: :ets.tid()
  @type lut() :: atom() | tid()
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

  @spec table_ref!(lut()) :: tid()
  def table_ref!(ref) when is_reference(ref) do
    ref
  end

  def table_ref!(name) when is_atom(name) do
    GenServer.call(name, :table_ref)
  end

  @spec update([t()], lut()) :: :ok
  def update(permissions, table \\ __MODULE__) do
    permissions
    |> Enum.map(&entry_for_permission/1)
    |> then(&:ets.insert(table_ref!(table), &1))

    :ok
  end

  defp entry_for_permission(%__MODULE__{} = permission) do
    {permission.assign_id, permission.scope_id, permission}
  end

  @doc """
  Find transient permissions that belong to the given roles.

  Returns a stream so that the search can be lazily executed and halts when the perms system finds
  a valid grant.
  """
  @spec for_roles([RoleGrant.t()], Permissions.lsn(), lut()) :: Enum.t()
  def for_roles(role_grants, lsn, table) do
    role_grants
    |> Stream.flat_map(&transient_for_roles(&1, table_ref!(table)))
    |> Stream.filter(&filter_expired(&1, lsn))
  end

  defp transient_for_roles(%{role: %Permissions.Role{} = role} = role_grant, name) do
    %{assign_id: assign_id, scope: {_, scope_id}} = role

    name
    |> :ets.match({assign_id, scope_id, :"$1"})
    # :ets.match/2 returns a list of lists but since we only return '$1' we only want the first
    |> Stream.map(fn m -> {role_grant, hd(m)} end)
  end

  defp filter_expired({_role_grant, %__MODULE__{valid_to: expires_lsn}}, change_lsn) do
    Lsn.compare(expires_lsn, change_lsn) in [:gt, :eq]
  end

  def start_link(attrs \\ []) do
    name = Keyword.get(attrs, :name, __MODULE__)
    GenServer.start_link(__MODULE__, name, name: name)
  end

  @impl GenServer
  def init(name) do
    table = :ets.new(name, [:bag, :public, read_concurrency: true])
    # TODO: boot and load all existing transient permissions
    {:ok, table}
  end

  @impl GenServer
  def handle_call(:table_ref, _from, table) do
    {:reply, table, table}
  end
end
