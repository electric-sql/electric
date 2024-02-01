defmodule Electric.Satellite.Permissions.Transient do
  use GenServer

  alias Electric.Satellite.{Permissions, Permissions.RoleGrant}
  alias Electric.Postgres.Lsn

  defstruct [:id, :assign_id, :scope_id, :target_relation, :target_id, :valid_to]

  defmodule IntermediateRole do
    defstruct [:role, :scope_resolver, :id]
  end

  @type tid() :: :ets.tid()
  @type lut() :: atom()
  @type relation() :: Electric.Postgres.relation()
  @type t() :: %__MODULE__{
          id: binary(),
          assign_id: binary(),
          scope_id: binary(),
          target_relation: relation(),
          target_id: binary(),
          valid_to: Electric.Postgres.Lsn.t()
        }

  @default_lut __MODULE__

  def new(attrs) do
    struct(__MODULE__, attrs)
  end

  @spec update([t()], lut()) :: :ok
  def update(permissions, table \\ @default_lut) do
    permissions
    |> Enum.map(&entry_for_permission/1)
    |> then(&:ets.insert(table, &1))

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
    |> Enum.flat_map(&transient_for_roles(&1, table))
    |> Stream.filter(&filter_expired(&1, lsn))
  end

  defp transient_for_roles(%{role: %Permissions.Role{} = role} = role_grant, table) do
    %{assign_id: assign_id, scope: {_, scope_id}} = role

    table
    |> :ets.match({assign_id, scope_id, :"$1"})
    # :ets.match/2 returns a list of lists but since we only return '$1' we only want the first
    |> Stream.map(fn [transient] -> {role_grant, transient} end)
  end

  defp filter_expired({_role_grant, %__MODULE__{valid_to: expires_lsn}}, change_lsn) do
    Lsn.compare(expires_lsn, change_lsn) in [:gt, :eq]
  end

  def start_link(attrs \\ []) do
    name = Keyword.get(attrs, :name, __MODULE__)
    GenServer.start_link(__MODULE__, name, name: name)
  end

  @impl GenServer
  def init(name) when is_atom(name) do
    table =
      :ets.new(name, [:bag, :public, :named_table, read_concurrency: true])

    # TODO: boot and load all existing transient permissions
    {:ok, table}
  end
end
