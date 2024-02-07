defmodule Electric.Postgres.Schema.Update do
  alias PgQuery, as: Pg

  alias Electric.Postgres.{
    Extension,
    Schema,
    Schema.AST,
    Schema.Catalog,
    Schema.Proto
  }

  require Logger
  import Electric.Postgres.Schema.Proto, only: [is_unique_constraint: 1]

  defmodule Error do
    defexception [:message]
  end

  import Schema, except: [update: 2]

  defmodule DropIndex do
    @moduledoc """
    Simple mapping of the drop index command that I can use in cascade events
    """
    @keys [:names]
    @enforce_keys @keys
    defstruct @keys
  end

  defmodule DropConstraint do
    @moduledoc """
    Simple mapping of the drop constraint command that I can use in cascade events
    """
    @keys [:table, :name, :constraint, :missing_ok]
    @enforce_keys @keys
    defstruct @keys
  end

  defmodule Opts do
    @moduledoc false

    defstruct [:oid_loader, if_not_exists: false, default_schema: "public"]

    @type t() :: %__MODULE__{
            oid_loader: Extension.SchemaLoader.oid_loader(),
            if_not_exists: boolean(),
            default_schema: binary()
          }

    @doc """
    Schema mapping configuration that doesn't require a valid implementation of an oid_loader function
    """
    def loose() do
      %__MODULE__{oid_loader: fn _, _, _ -> {:ok, 0} end}
    end

    def strict() do
      %__MODULE__{
        oid_loader: fn _, _, _ -> raise RuntimeError, message: "Invalid oid_loader function" end
      }
    end
  end

  def apply_stmt(schema, stmt, opts) when is_binary(stmt) do
    apply_stmt(schema, Electric.Postgres.parse!(stmt), opts)
  end

  def apply_stmt(schema, cmds, opts) when is_list(opts) do
    oid_loader = Schema.verify_oid_loader!(opts)

    opts = %Opts{oid_loader: oid_loader}
    apply_stmt(schema, cmds, opts)
  end

  def apply_stmt(schema, cmds, opts) do
    update_schema(cmds, schema, opts)
  end

  defp update_schema([], schema, _opts) do
    schema
  end

  defp update_schema([cmd | cmds], schema, opts) do
    {cascade, schema} = do_update(cmd, schema, opts)
    update_schema(cmds, update_schema(cascade, schema, opts), opts)
  end

  defp do_update(%Pg.CreateStmt{} = action, schema, opts) do
    %{relation: name} = action
    Logger.info("CREATE TABLE #{name.relname} (...)")

    table = AST.create(action, opts)

    schema = %{schema | tables: schema.tables ++ [table]}
    __MODULE__.Cascade.update(action, table, schema)
  end

  defp do_update(%Pg.AlterTableStmt{} = action, schema, opts) do
    name = AST.map(action.relation, opts)

    case {fetch_table(schema, name), action.missing_ok} do
      {{:ok, orig_table}, _} ->
        {tables, cmds} =
          Enum.map_reduce(schema.tables, [], fn table, cascade ->
            if equal?(table.name, name) do
              {table, alter} = __MODULE__.AlterTable.update(action.cmds, orig_table)
              {table, cascade ++ alter}
            else
              {table, cascade}
            end
          end)

        schema = update_schema(cmds, %{schema | tables: tables}, opts)

        __MODULE__.Cascade.update(action.cmds, orig_table, schema)

      {{:error, _}, true} ->
        {[], schema}

      {{:error, _}, false} ->
        raise Error, message: "attempt to alter missing table #{name}"
    end
  end

  defp do_update(
         %Pg.RenameStmt{rename_type: :OBJECT_COLUMN, relation_type: :OBJECT_TABLE} = action,
         schema,
         _opts
       ) do
    Logger.info(
      "ALTER TABLE #{action.relation} RENAME COLUMN #{action.subname} TO #{action.newname}"
    )

    {:ok, orig_table} = fetch_table(schema, action.relation)

    schema =
      update_table(
        schema,
        action.relation,
        fn table ->
          rename = fn list ->
            list
            |> Enum.map(&Catalog.rename_column(&1, action.subname, action.newname))
            |> Schema.order()
          end

          table
          |> update_column(action.subname, fn column ->
            %{column | name: action.newname}
          end)
          |> Map.update!(:columns, fn columns ->
            Enum.map(columns, fn col -> %{col | constraints: rename.(col.constraints)} end)
          end)
          |> Map.update!(:constraints, rename)
          |> Map.update!(:indexes, rename)
        end,
        action.missing_ok
      )

    __MODULE__.Cascade.update(action, orig_table, schema)
  end

  defp do_update(%Pg.RenameStmt{rename_type: :OBJECT_TABLE} = action, schema, _opts) do
    Logger.info("ALTER TABLE #{action.relation} RENAME TO #{action.newname}")

    {:ok, orig_table} = fetch_table(schema, action.relation)

    schema =
      update_table(
        schema,
        action.relation,
        fn table ->
          name = Proto.rename(table.name, action.newname)

          %{table | name: name}
          |> Map.update!(:indexes, fn indexes ->
            Enum.map(indexes, &%{&1 | table: name})
          end)
        end,
        action.missing_ok
      )

    __MODULE__.Cascade.update(action, orig_table, schema)
  end

  defp do_update(%Pg.RenameStmt{rename_type: :OBJECT_TABCONSTRAINT} = action, schema, _opts) do
    Logger.info("ALTER TABLE #{action.relation} RENAME CONSTRAINT #{action.subname}")
    {:ok, table} = fetch_table(schema, action.relation)

    schema =
      update_table(
        schema,
        action.relation,
        fn table ->
          update_constraint(
            table,
            action.subname,
            fn %{constraint: {tag, c}} = constraint ->
              %{constraint | constraint: {tag, %{c | name: action.newname}}}
            end,
            action.missing_ok
          )
        end,
        action.missing_ok
      )

    __MODULE__.Cascade.update(action, table, schema)
  end

  defp do_update(%Pg.RenameStmt{rename_type: :OBJECT_INDEX} = action, schema, _opts) do
    Logger.info("ALTER INDEX #{action.relation} RENAME TO \"#{action.newname}\"")

    tables =
      Enum.map(schema.tables, fn table ->
        if Schema.same_schema?(table.name.schema, action.relation.schemaname) do
          table
          |> update_in_place(
            :indexes,
            action.relation.relname,
            fn index ->
              %{index | name: action.newname}
            end,
            true
          )
          |> Map.update!(:indexes, &order/1)
          # constraints create indexes, renaming those indexes renames the constraint
          # since I'm choosing to have "virtual" indexes, that are defined by the
          # constraints, rather than manage constraints and indexes, I need to
          # apply this to the constraints too.
          # (better?) alternative would be to have a constraint that refers to an index
          # so we model more closely the relation in pg
          |> update_in_place(
            :constraints,
            action.relation.relname,
            fn %{constraint: {tag, c}} = constraint ->
              c = %{c | name: action.newname}
              %{constraint | constraint: {tag, c}}
            end,
            true
          )
          |> Map.update!(:constraints, &order/1)
        else
          table
        end
      end)

    {[], %{schema | tables: tables}}
  end

  defp do_update(%Pg.DropStmt{remove_type: :OBJECT_TABLE} = action, schema, _opts) do
    tables = AST.map(action.objects)
    Logger.info("DROP TABLE #{Enum.join(tables, ",")}")
    table_names = Enum.map(tables, &Proto.range_var/1)

    if !action.missing_ok do
      Enum.each(table_names, fn table ->
        case Schema.fetch_table(schema, table) do
          {:error, _} ->
            raise(Error, message: "attempting to drop non-existant table #{table}")

          _ ->
            nil
        end
      end)
    end

    {drop_tables, keep_tables} =
      Enum.split_with(schema.tables, fn table ->
        Enum.any?(table_names, fn name -> equal?(table.name, name) end)
      end)

    schema = %{schema | tables: keep_tables}

    Enum.flat_map_reduce(table_names, schema, fn table_name, schema ->
      table = Enum.find(drop_tables, &equal?(&1.name, table_name))
      __MODULE__.Cascade.update({:drop_table, table_name}, table, schema)
    end)
  end

  defp do_update(%Pg.DropStmt{remove_type: :OBJECT_INDEX} = action, schema, opts) do
    index_names = AST.map(action.objects)
    do_update(%Schema.Update.DropIndex{names: index_names}, schema, opts)
  end

  defp do_update(%DropConstraint{} = action, schema, _opts) do
    Logger.info("ALTER TABLE #{action.table} DROP CONSTRAINT #{action.name}")

    {:ok, table} = fetch_table(schema, action.table)

    schema =
      update_table(
        schema,
        action.table,
        fn table ->
          constraints =
            Enum.reject(table.constraints, fn %{constraint: {_, %{name: name}}} ->
              name == action.name
            end)

          %{table | constraints: constraints}
        end,
        action.missing_ok
      )

    __MODULE__.Cascade.update(action, table, schema)
  end

  defp do_update(%DropIndex{} = cmd, schema, _opts) do
    indexes = Enum.map(cmd.names, &Proto.range_var/1)
    ids = Enum.group_by(indexes, & &1.schema, & &1.name)

    Logger.info("DROP INDEX #{indexes |> Enum.join(", ")}")

    tables =
      Enum.map(schema.tables, fn table ->
        indexnames =
          Enum.find_value(Schema.search_schemas(table.name.schema), fn s ->
            Map.get(ids, s)
          end)

        if indexnames do
          %{table | indexes: Enum.reject(table.indexes, &(&1.name in indexnames))}
        else
          table
        end
      end)

    {[], %{schema | tables: tables}}
  end

  defp do_update(%Pg.IndexStmt{} = create_index, schema, opts) do
    Logger.info("CREATE INDEX #{create_index.idxname} ...")

    index_columns = AST.map(create_index.index_params)
    index_including = AST.map(create_index.index_including_params)

    schema =
      update_in_place(
        schema,
        :tables,
        create_index.relation,
        fn table ->
          name =
            case create_index.idxname do
              empty when empty in ["", nil] ->
                column_names = Enum.map(index_columns ++ List.wrap(index_including), & &1.name)

                ensure_name_unique(
                  &Schema.constraint_name(nil, table.name.name, column_names, &1),
                  fn n -> !Enum.any?(table.indexes, &(&1.name == n)) end,
                  "idx"
                )

              name when is_binary(name) ->
                name
            end

          {:ok, oid} = opts.oid_loader.(:index, table.name.schema, name)

          index = %Proto.Index{
            name: name,
            oid: oid,
            table: table.name,
            unique: create_index.unique,
            columns: index_columns,
            including: Enum.map(index_including, & &1.name),
            where: AST.map(create_index.where_clause),
            using: create_index.access_method
          }

          %{table | indexes: order([index | table.indexes])}
        end,
        false
      )

    {[], schema}
  end

  defp do_update(%PgQuery.CreateEnumStmt{} = action, schema, opts) do
    name =
      case AST.map(action.type_name, opts) do
        [schema, name] -> %Proto.RangeVar{schema: schema, name: name}
        [name] -> %Proto.RangeVar{schema: opts.default_schema, name: name}
      end

    values = AST.map(action.vals)

    Logger.info("CREATE ENUM #{name} WITH VALUES #{inspect(values)}")

    enum = %Proto.Enum{name: name, values: values}
    schema = %{schema | enums: Enum.uniq_by([enum | schema.enums], & &1.name)}

    {[], schema}
  end

  defp do_update(stmt, schema, _opts) do
    Logger.warning("ignoring unsupported migration: #{inspect(stmt)}")
    {[], schema}
  end

  defp ensure_name_unique(name_fun, valid_fun, base) do
    [""]
    |> Stream.concat(Stream.iterate(1, &(&1 + 1)))
    |> Stream.map(&(base <> to_string(&1)))
    |> Stream.map(name_fun)
    |> Enum.find(valid_fun)
  end

  def unique_constraint?(c) do
    case c do
      c when is_unique_constraint(c) -> true
      _ -> false
    end
  end

  def update_column(table, name, update_fun) do
    update_in_place(table, :columns, name, update_fun, false)
  end

  def update_table(schema, name, update_fun, missing_ok \\ false) do
    update_in_place(schema, :tables, name, update_fun, missing_ok)
  end

  def update_constraint(table, name, update_fun, missing_ok) do
    table
    |> update_in_place(:constraints, name, update_fun, missing_ok)
    |> Map.update!(:constraints, &order/1)
  end

  def update_in_place(map, key, name, update_fun, missing_ok) when is_map(map) do
    Map.update!(map, key, fn
      nil ->
        nil

      els when is_list(els) ->
        update_list_in_place(els, name, update_fun, missing_ok)
    end)
  end

  defp update_list_in_place(list, name, update_fun, missing_ok) when is_list(list) do
    name_fun = fn
      %{name: name} ->
        name

      %{constraint: {_tag, %{name: name}}} ->
        name
    end

    {updated, count} =
      Enum.map_reduce(list, 0, fn el, count ->
        if equal?(name_fun.(el), name) do
          {update_fun.(el), count + 1}
        else
          {el, count}
        end
      end)

    if count == 0 && !missing_ok,
      do: raise("update of #{inspect(list)} matching #{inspect(name)} did not match any elements")

    updated
  end

  @not_null %Proto.Constraint{constraint: {:not_null, %Proto.Constraint.NotNull{}}}

  def ensure_not_null_constraint(column, constraint \\ @not_null) do
    if Enum.find(column.constraints, fn %{constraint: {type, _con}} -> type == :not_null end) do
      column
    else
      %{column | constraints: order([constraint | column.constraints])}
    end
  end
end
