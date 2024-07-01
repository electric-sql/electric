defmodule Electric.Postgres.Schema.Update.Cascade do
  alias PgQuery, as: Pg

  alias Electric.Postgres.{Schema, Schema.Catalog}

  require Logger

  import Electric.Postgres.Schema.Proto, only: [is_unique_constraint: 1]

  def update({%Pg.AlterTableCmd{subtype: :AT_DropConstraint} = cmd, constraint}, table, schema) do
    Logger.debug("CASCADE: ALTER TABLE #{table.name} DROP CONSTRAINT #{cmd.name}")
    # we are dropping a constraint on table a
    # check if column with constraint has any unqiue constraints remaining
    # if not, then find fks referencing this column and drop them...

    # need to get the modified table from the current schema because we need the
    # current state of the table constraints
    {:ok, table} = Schema.fetch_table(schema, table.name)

    keys = Catalog.keys(constraint)

    has_unique_constraint =
      table.constraints
      |> Stream.filter(&Schema.Update.unique_constraint?/1)
      |> Enum.any?(fn constraint -> Catalog.keys(constraint) == keys end)

    cmds =
      if has_unique_constraint do
        []
      else
        schema
        |> tables_excluding(table.name)
        |> Enum.flat_map(
          &drop_constraints_matching(&1, fn constraint ->
            Catalog.depends_on_constraint?(constraint, table.name, keys)
          end)
        )
      end

    {cmds, schema}
  end

  def update(
        %Pg.RenameStmt{rename_type: :OBJECT_COLUMN, relation_type: :OBJECT_TABLE} = action,
        table,
        schema
      ) do
    Logger.debug(
      "CASCADE: ALTER TABLE #{table.name} RENAME COLUMN #{action.subname} TO #{action.newname}"
    )

    tables =
      Enum.map(schema.tables, fn t ->
        Map.update!(
          t,
          :constraints,
          fn constraints ->
            Enum.map(constraints, fn constraint ->
              Catalog.rename_column(constraint, table.name, action.subname, action.newname)
            end)
            |> Schema.order()
          end
        )
      end)

    {[], %{schema | tables: tables}}
  end

  def update(%Pg.RenameStmt{rename_type: :OBJECT_TABLE} = action, table, schema) do
    Logger.debug("CASCADE: ALTER TABLE #{table.name} RENAME TO #{action.newname}")
    # find constraints that link columns in other tables to the column being renamed
    # then rename the column references in those columns
    tables =
      Enum.map(schema.tables, fn t ->
        Map.update!(
          t,
          :constraints,
          fn constraints ->
            Enum.map(constraints, fn constraint ->
              Catalog.rename_table(constraint, table.name, action.newname)
            end)
            |> Schema.order()
          end
        )
      end)

    {[], %{schema | tables: tables}}
  end

  def update({:drop_table, drop_table}, _table, schema) do
    Logger.debug("CASCADE: DROP TABLE #{drop_table}")

    commands =
      schema.tables
      |> Enum.flat_map(fn table ->
        # need to get columns in table that have constraints that link to dropped table
        drop_constraints_matching(table, &Catalog.depends_on_table?(&1, drop_table))
      end)

    {commands, schema}
  end

  def update(%Schema.Update.DropConstraint{constraint: constraint} = action, _orig_table, schema)
      when is_unique_constraint(constraint) do
    Logger.debug("CASCADE: ALTER TABLE #{action.table} DROP [UNIQUE] CONSTRAINT #{action.name}")
    # dropping a unique constraint means dropping any fk constraints that refer
    # to the keys in the unique constraint

    {:ok, table} = Schema.fetch_table(schema, action.table)
    keys = Catalog.keys(constraint)

    # we are dropping a constraint on table "a"
    # check if column with constraint has any unqiue constraints remaining
    # if not, then find fks referencing this column and drop them...
    has_unique_constraint =
      table.constraints
      |> Stream.filter(&Schema.Update.unique_constraint?/1)
      |> Enum.any?(fn constraint -> Catalog.keys(constraint) == keys end)

    cmds =
      if has_unique_constraint do
        []
      else
        schema
        |> tables_excluding(table.name)
        |> Enum.flat_map(
          &drop_constraints_matching(&1, fn constraint ->
            Catalog.depends_on_constraint?(constraint, table.name, keys)
          end)
        )
      end

    {cmds, schema}
  end

  def update(%Schema.Update.DropConstraint{}, _table, schema) do
    # Dropping a non-unqiue constraint doesn't have any cascading effects

    {[], schema}
  end

  def update(_action, _table, schema) do
    {[], schema}
  end

  defp drop_constraints_matching(table, match_fun) when is_function(match_fun, 1) do
    cmds =
      table.constraints
      |> Enum.filter(match_fun)
      |> Enum.map(fn %{constraint: {_, %{name: name}}} = constraint ->
        %Schema.Update.DropConstraint{
          table: table.name,
          name: name,
          constraint: constraint,
          missing_ok: false
        }
      end)

    cmds
  end

  defp tables_excluding(schema, table_name) do
    schema.tables
    |> Enum.reject(&Schema.equal?(&1.name, table_name))
  end
end
