defmodule Electric.Postgres.OidDatabase do
  # `ETS.Set.match!/2` has incorrect spec
  @dialyzer {:nowarn_function, oid_for_name: 1}

  @ets_table_name :oid_database

  import Electric.Postgres.OidDatabase.PgType
  use GenServer

  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  def save_oids(server \\ __MODULE__, values) do
    GenServer.call(server, {:save_oids, Enum.map(values, &pg_type_from_tuple/1)})
  end

  @doc """
  Get an atom name by the type OID
  """
  def name_for_oid(oid) do
    case :ets.lookup(@ets_table_name, oid) do
      [pg_type(is_array: false, name: name)] -> name
      [pg_type(is_array: true, element_oid: element)] -> {:array, name_for_oid(element)}
      _ -> raise("Unknown OID #{oid}, cannot get a name that won't result in data loss")
    end
  end

  @doc """
  Get the type OID by the name atom
  """
  def oid_for_name({:array, element_name}) do
    case :ets.match(@ets_table_name, pg_type(name: element_name, array_oid: :"$1")) do
      [[oid]] -> oid
      _ -> raise("Unknown name {:array, #{element_name}}")
    end
  end

  def oid_for_name(name) do
    case :ets.match(@ets_table_name, pg_type(name: name, oid: :"$1")) do
      [[oid]] -> oid
      _ -> raise("Unknown name #{name}")
    end
  end

  def type_length(oid) when is_integer(oid) do
    case :ets.lookup(@ets_table_name, oid) do
      [pg_type(length: len)] -> len
      _ -> raise("Unknown OID #{oid}")
    end
  end

  def type_length({:array, _}), do: raise("Can't get type length of an array type")

  def type_length(name) do
    case :ets.match(@ets_table_name, pg_type(name: name, length: :"$1")) do
      [[len]] -> len
      _ -> raise("Unknown name #{name}")
    end
  end

  def init(_) do
    {:ok, table} =
      ETS.Set.new(
        name: @ets_table_name,
        keypos: 2,
        protection: :protected,
        read_concurrency: true
      )

    ETS.Set.put(table, Electric.Postgres.OidDatabase.Defaults.get_defaults())

    {:ok, %{table: table}}
  end

  def handle_call({:save_oids, values}, _, state) do
    ETS.Set.put(state.table, values)

    {:reply, :ok, state}
  end
end
