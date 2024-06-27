defmodule Electric.DDLX do
  @moduledoc """
  Mostly creates SQL for adding DDLX to postgres
  """
  alias Electric.DDLX.Parser
  alias Electric.DDLX.Command
  alias Electric.Satellite.SatPerms
  alias Electric.Satellite.Permissions

  @read_privs Permissions.read_privileges()
  @write_privs Permissions.write_privileges()

  @spec parse(String.t(), Parser.opts()) :: {:ok, Command.t()} | {:error, Command.Error.t()}
  def parse(statement, opts \\ []) do
    Parser.parse(statement, opts)
  end

  @spec parse!(String.t(), Parser.opts()) :: Command.t() | no_return()
  def parse!(statement, opts \\ []) do
    case parse(statement, opts) do
      {:ok, cmd} -> cmd
      {:error, error} -> raise error
    end
  end

  @doc """
  Turns Electric.DDLX.Commands.Command structs into PostgreSQL
  """
  @spec command_to_postgres(Command.t() | [Command.t()]) :: [String.t()]
  def command_to_postgres(command) do
    Command.proxy_sql(command)
  end

  @spec permissions_state(%{term() => term()}, Electric.Postgres.relation()) :: %{
          select: boolean(),
          insert: boolean(),
          update: boolean(),
          delete: boolean(),
          read: boolean(),
          write: boolean()
        }
  def permissions_state(%{Electric.DDLX => %SatPerms.Rules{} = rules}, relation) do
    permissions_state(rules, relation)
  end

  def permissions_state(%SatPerms.Rules{} = rules, {schema, name}) do
    rules.grants
    |> Enum.filter(&match?(%{table: %{schema: ^schema, name: ^name}}, &1))
    |> Enum.reduce(
      %{select: false, insert: false, update: false, delete: false, read: false, write: false},
      fn %{privilege: p}, %{select: s, insert: i, update: u, delete: d, read: r, write: w} ->
        %{
          insert: i || p == :INSERT,
          update: u || p == :UPDATE,
          delete: d || p == :DELETE,
          select: s || p == :SELECT,
          read: r || p in @read_privs,
          write: w || p in @write_privs
        }
      end
    )
  end

  # NOTE: part of a (future) behaviour used by Proxy.Injector.State[.Tx] to
  # manage perms
  def update_permissions(%Command{action: action}, %SatPerms.Rules{} = rules) do
    {:ok, _n, _rules} =
      Permissions.State.apply_ddlx_txn(action, rules)
  end

  # NOTE: another behaviour callback. Should return the list of tables that have been granted
  # write permisisons in the txn
  def granted_write_permissions(
        %SatPerms.Rules{} = initial_rules,
        %SatPerms.Rules{} = final_rules
      ) do
    initial_perms =
      Enum.group_by(initial_rules.grants, &{&1.table.schema, &1.table.name}, & &1.privilege)

    final_perms =
      Enum.group_by(final_rules.grants, &{&1.table.schema, &1.table.name}, & &1.privilege)

    final_perms
    |> Enum.filter(fn {relation, final_privs} ->
      diff = final_privs -- Map.get(initial_perms, relation, [])
      Enum.any?(diff, &(&1 in @write_privs))
    end)
    |> Enum.map(&elem(&1, 0))
  end

  def finalise_permissions(rules) do
    Permissions.State.commit(rules)
  end
end
