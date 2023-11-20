defmodule Electric.Postgres.OidDatabase do
  use GenServer

  import Electric.Postgres.OidDatabase.PgType
  alias Electric.Postgres.OidDatabase.PgType

  @type oid :: integer
  @type type_name :: atom | binary

  @oid_table :oid_database

  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  def save_oids(server \\ __MODULE__, values) do
    GenServer.call(server, {:save_oids, Enum.map(values, &pg_type_from_tuple/1)})
  end

  @spec name_for_oid(oid) :: type_name | {:array, type_name}
  def name_for_oid(oid) do
    case :ets.lookup(@oid_table, oid) do
      [pg_type(is_array: false, name: name)] -> name
      [pg_type(is_array: true, element_oid: element_oid)] -> {:array, name_for_oid(element_oid)}
      _ -> raise "Unknown OID #{oid}, cannot get a name that won't result in data loss"
    end
  end

  @spec oid_for_name(type_name | {:array, type_name}) :: oid
  def oid_for_name({:array, element_name}) do
    case :ets.match(@oid_table, pg_type(name: element_name, array_oid: :"$1")) do
      [[oid]] -> oid
      _ -> raise "Unknown name {:array, #{inspect(element_name)}}"
    end
  end

  def oid_for_name(name) do
    case :ets.match(@oid_table, pg_type(name: name, oid: :"$1")) do
      [[oid]] -> oid
      _ -> raise "Unknown name #{inspect(name)}"
    end
  end

  @spec pg_type_for_name(atom | binary) :: PgType.t()
  def pg_type_for_name(name) do
    case :ets.match_object(@oid_table, pg_type(name: name)) do
      [pg_type() = type] -> type
      _ -> raise "Unknown type for name #{inspect(name)}"
    end
  end

  def init(_) do
    oid_table = :ets.new(@oid_table, [:set, :named_table, keypos: 2, read_concurrency: true])
    :ets.insert(oid_table, Electric.Postgres.OidDatabase.Defaults.get_defaults())

    {:ok, %{oid_table: oid_table}}
  end

  def handle_call({:save_oids, types}, _from, state) do
    :ets.insert(state.oid_table, types)
    {:reply, :ok, state}
  end
end
