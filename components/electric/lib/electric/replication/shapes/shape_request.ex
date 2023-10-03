defmodule Electric.Replication.Shapes.ShapeRequest do
  @moduledoc """
  The validated and structured shape request that came from the client.

  Shape requests are part of a subscription that the client establishes. They are used
  in two general areas: first, when the subscription is requested, we need to fetch
  data from PG according to the shape request, and second, when the subscription is
  established, we're using the shape requests to filter the replication stream.

  > #### TODO: Missing features {: .info}
  >
  > This module currently implements a very basic understanding of the shape requests.
  > Each public function in this module will need to be updated, as the functionality is added
  > to the `satellite.proto` file.
  """
  require Logger
  alias Electric.Replication.Changes.Ownership
  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Postgres.Schema
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Replication.Changes
  alias Electric.Replication.Eval
  use Electric.Satellite.Protobuf

  defstruct [:id, :included_tables, where: %{}]

  @type t() :: %__MODULE__{
          id: String.t(),
          included_tables: [String.t(), ...],
          where: %{optional(String.t()) => Eval.Expr.t()}
        }

  @doc """
  Check if the given record belongs to this shape.
  """
  @spec record_belongs_to_shape?(t(), Changes.relation(), Changes.record()) :: boolean()
  def record_belongs_to_shape?(%__MODULE__{} = shape, relation, record) do
    if relation in shape.included_tables do
      where = shape.where[relation]

      if not is_nil(where) do
        with {:ok, refs} <- Eval.Runner.record_to_ref_values(where.used_refs, record, relation),
             {:ok, value} <- Eval.Runner.execute(where.eval, refs) do
          value
        else
          _ -> false
        end
      else
        true
      end
    else
      false
    end
  end

  @doc """
  Check if the given update moves a row into the shape, out of the shape, or keeps it in or out of the shape.

  If either `old_record` or `record` fields cannot be converted to Elixir-native types, return `:error`.
  """
  @spec get_update_position_in_shape(t(), Changes.UpdatedRecord.t()) ::
          :in | :not_in | :move_in | :move_out | :error
  def get_update_position_in_shape(
        %__MODULE__{} = shape,
        %Changes.UpdatedRecord{relation: rel} = change
      ) do
    if rel in shape.included_tables do
      where = shape.where[rel]

      if not is_nil(where) do
        used_refs = where.used_refs

        with {:ok, old} <- Eval.Runner.record_to_ref_values(used_refs, change.old_record, rel),
             {:ok, new} <- Eval.Runner.record_to_ref_values(used_refs, change.record, rel),
             {:ok, old_satisfies?} <- Eval.Runner.execute(where.eval, old),
             {:ok, new_satisfies?} <- Eval.Runner.execute(where.eval, new) do
          case {old_satisfies?, new_satisfies?} do
            {false, false} -> :not_in
            {false, true} -> :move_in
            {true, false} -> :move_out
            {true, true} -> :in
          end
        else
          :error ->
            # Failed to parse the record into refs
            Logger.warning("""
            Could not convert the string record values to internal types
            """)

            :error

          {:error, {%{name: name}, args}} ->
            # Failed to apply "where" function on either old or new values.
            Logger.warning("""
            Could not calculate if the row is in or not in the shape: failed to apply #{name} to arguments #{inspect(args)}.
            """)

            :error
        end
      else
        :in
      end
    else
      :not_in
    end
  end

  @doc """
  Build a struct from the Protobuf representation of the shape request,
  using a map of pre-parsed where statements.

  This function will fail if the request contains a where statement that's not
  present in the `where_statements` map.
  """
  @spec from_satellite_request(%SatShapeReq{}, %{String.t() => Eval.Expr.t()}) :: t()
  def from_satellite_request(
        %SatShapeReq{request_id: id, shape_definition: shape},
        where_statements
      ) do
    included_tables = Enum.map(shape.selects, &{"public", &1.tablename})

    where =
      shape.selects
      |> Enum.filter(&(&1.where != ""))
      |> Map.new(&{{"public", &1.tablename}, Map.fetch!(where_statements, &1.where)})

    %__MODULE__{
      id: id,
      included_tables: included_tables,
      where: where
    }
  end

  @doc """
  Get the names of tables included in this shape request.

  If the name is in this list, it doesn't necessarily mean any data from
  that table will actually fall into the shape, but it will likely be queried.
  """
  @spec included_tables(t()) :: [String.t(), ...]
  def included_tables(%__MODULE__{included_tables: tables}) do
    tables
  end

  @doc """
  Get the hash of the entire shape request, bar the id.
  """
  @spec hash(t()) :: binary()
  def hash(%__MODULE__{} = req) do
    %{req | id: ""}
    |> :erlang.term_to_iovec([:deterministic])
    |> then(&:crypto.hash(:sha, &1))
  end

  @empty_filtering_context %{fully_sent_tables: MapSet.new(), applied_where_clauses: %{}}

  @doc """
  Prepare filtering context based on the previous shape requests.
  """
  def prepare_filtering_context(sent_requests) do
    Enum.reduce(sent_requests, @empty_filtering_context, fn %__MODULE__{} = req, acc ->
      # If there are where clauses, append them
      acc =
        Enum.reduce(req.where, acc.applied_where_clauses, fn {k, v}, acc ->
          Map.update(acc, k, [v.query], &[v.query | &1])
        end)
        |> then(&Map.put(acc, :applied_where_clauses, &1))

      # If there are sent tables without where clauses, mark them fully sent
      acc =
        req.included_tables
        |> Enum.reject(&is_map_key(req.where, &1))
        |> MapSet.new()
        |> MapSet.union(acc.fully_sent_tables)
        |> then(&Map.put(acc, :fully_sent_tables, &1))

      acc
    end)
  end

  @doc """
  Query PostgreSQL for initial data which corresponds to this shape request.

  Each shape request requires a different initial dataset, so this function
  encapsulates that. The arguments, apart from the shape request itself, are:
  - `conn` - the `:epgsql` connection to use for queries.
  - `schema` - the `%Electric.Postgres.Schema.Proto.Schema{}` struct, used to get
    columns and other information required to build queries
  - `origin` - PG origin that's used to convert PG tags to Satellite tags.
    See `Electric.Postgres.ShadowTableTransformation.convert_tag_list_pg_to_satellite/2`
    for details.
  - `filtering_context` - additional information that needs to be taken into consideration
    when building a query, like permissions or rows that need to be ignored

  ## Transaction requirements

  Stability and validity of the results depends on running in the correct transaction.
  This function may execute multiple queries separately and expects the data to be stable,
  so the connection needs to be in a transaction with `ISOLATION LEVEL REPEATABLE READ`
  set (see [PG documentation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-REPEATABLE-READ)
  for details.)
  """
  @spec query_initial_data(t(), :epgsql.connection(), SchemaLoader.Version.t(), String.t(), map()) ::
          {:ok, non_neg_integer, [Changes.NewRecord.t()]} | {:error, term()}
  # TODO: `filtering_context` is underdefined by design. It's a stand-in for a more complex solution while we need to enable basic functionality.
  def query_initial_data(
        %__MODULE__{} = request,
        conn,
        schema_version,
        origin,
        filtering_context \\ @empty_filtering_context
      ) do
    Enum.reduce_while(request.included_tables, {:ok, 0, []}, fn table, {:ok, num_records, acc} ->
      where =
        case request.where[table] do
          %Eval.Expr{query: query} -> query
          _ -> nil
        end

      case query_full_table(conn, table, schema_version, origin, where, filtering_context) do
        {:ok, count, results} ->
          {:cont, {:ok, num_records + count, acc ++ results}}

        {:error, error} ->
          Logger.error("""
          Error while trying to fulfill the subscription data:
          #{String.replace(inspect(error, pretty: true), ~r/^/m, "  ")}"
          """)

          {:halt, {:error, error}}
      end
    end)
  end

  defp query_full_table(
         conn,
         {schema_name, name} = rel,
         schema_version,
         origin,
         where_filter,
         filtering_context
       ) do
    if MapSet.member?(filtering_context.fully_sent_tables, rel) do
      {:ok, 0, []}
    else
      {:ok, table} = SchemaLoader.Version.table(schema_version, rel)
      columns = Enum.map_join(table.columns, ", ", &~s|this."#{&1.name}"|)
      {:ok, pks} = SchemaLoader.Version.primary_keys(schema_version, rel)
      pk_clause = Enum.map_join(pks, " AND ", &~s|this."#{&1}" = shadow."#{&1}"|)

      where_clauses =
        [
          filter_on_ownership(table, filtering_context),
          where_filter,
          filter_on_inverse_of_sent(rel, filtering_context)
        ]
        |> Enum.reject(&(is_nil(&1) or &1 == ""))
        |> Enum.join(" AND ")

      where = if where_clauses != "", do: "WHERE #{where_clauses}", else: ""

      query = """
      SELECT shadow."_tags", #{columns}
        FROM #{Schema.name(schema_name)}.#{Schema.name(name)} as this
        JOIN electric."shadow__#{schema_name}__#{name}" as shadow
          ON #{pk_clause}
        #{where}
      """

      case :epgsql.squery(conn, query) do
        {:ok, _, rows} ->
          {records, count} =
            rows_to_records_with_tags(rows, Enum.map(table.columns, & &1.name), rel, origin)

          {:ok, count, records}

        {:error, _} = error ->
          error
      end
    end
  end

  @spec rows_to_records_with_tags([tuple()], [String.t(), ...], term(), String.t()) ::
          {[Changes.NewRecord.t()], non_neg_integer()}
  defp rows_to_records_with_tags(rows, col_names, relation, origin) when is_list(rows) do
    Enum.map_reduce(rows, 0, fn row_tuple, count ->
      [tags | values] = Tuple.to_list(row_tuple)

      row =
        Enum.zip(col_names, values)
        |> Map.new()

      record = %Changes.NewRecord{
        relation: relation,
        record: row,
        tags: ShadowTableTransformation.convert_tag_list_pg_to_satellite(tags, origin)
      }

      {record, count + 1}
    end)
  end

  defp filter_on_ownership(table, filtering_context) do
    ownership_column = Ownership.id_column_name()

    if filtering_context[:user_id] && Enum.any?(table.columns, &(&1.name == ownership_column)) do
      escaped = String.replace(filtering_context[:user_id], "'", "''")

      # We're using explicit interpolation here instead of extended query, because we need all columns regardless of type to be returned as binaries
      "#{ownership_column} = '#{escaped}'"
    end
  end

  defp filter_on_inverse_of_sent(rel, context) do
    case context[:applied_where_clauses][rel] do
      nil -> nil
      # If we've filtered this table before, then invert the old filter to avoid duplicates
      clauses -> clauses |> Enum.map_join(" AND ", &"NOT (#{&1})")
    end
  end
end
