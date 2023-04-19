defmodule Electric.Postgres.Schema.Update.AlterTable do
  alias PgQuery, as: Pg
  alias Electric.Postgres.{Schema, Schema.AST, Schema.Catalog, Schema.Proto}

  require Logger

  def update([_ | _] = cmds, table) do
    {cascade, table} = Enum.flat_map_reduce(cmds, table, &update/2)
    {table, cascade}
  end

  def update(
        %{
          node: {:alter_table_cmd, %Pg.AlterTableCmd{subtype: :AT_ColumnDefault, def: nil} = cmd}
        },
        table
      ) do
    Logger.info("ALTER TABLE #{table.name} #{cmd.name} DROP DEFAULT")

    {[],
     update_column(table, cmd.name, fn column ->
       constraints =
         Enum.reject(List.wrap(column.constraints), fn %Proto.Constraint{constraint: {type, _}} ->
           type == :default
         end)

       %{column | constraints: Schema.order(constraints)}
     end)}
  end

  def update(
        %{node: {:alter_table_cmd, %Pg.AlterTableCmd{subtype: :AT_ColumnDefault} = cmd}},
        table
      ) do
    Logger.info("ALTER TABLE #{table.name} #{cmd.name} SET DEFAULT")

    {[],
     update_column(table, cmd.name, fn column ->
       default = %Proto.Constraint{
         constraint: {:default, %Proto.Constraint.Default{expr: AST.map(cmd.def)}}
       }

       constraints =
         Enum.reject(List.wrap(column.constraints), fn %Proto.Constraint{constraint: {type, _}} ->
           type == :default
         end)

       %{column | constraints: Schema.order([default | constraints])}
     end)}
  end

  def update(%{node: {:alter_table_cmd, %{subtype: :AT_AddColumn} = cmd}}, table) do
    Logger.info("ALTER TABLE #{table.name} ADD COLUMN...")
    table = AST.add_column(cmd.def, table, if_not_exists: cmd.missing_ok)
    {[], table}
  end

  def update(%{node: {:alter_table_cmd, %{subtype: :AT_AddConstraint} = cmd}}, table) do
    Logger.info("ALTER TABLE #{table.name} ADD CONSTRAINT...")

    %{node: {:constraint, con}} = cmd.def

    constraint = AST.constraint(con, table)

    {
      [],
      cappend(table, constraint) |> update_column_constraints(constraint)
    }
  end

  def update(%{node: {:alter_table_cmd, %{subtype: :AT_DropColumn} = cmd}}, table) do
    Logger.info("ALTER TABLE #{table.name} DROP COLUMN #{cmd.name}")

    table = %{table | columns: Enum.reject(table.columns, &(&1.name == cmd.name))}

    alter_table =
      table.constraints
      |> Enum.filter(&Catalog.depends_on_column?(&1, cmd.name))
      |> Enum.map(fn %{constraint: {_type, %{name: name}}} = constraint ->
        # FIXME: replace with the pgquery equivalent
        %Schema.Update.DropConstraint{
          table: table.name,
          name: name,
          constraint: constraint,
          missing_ok: cmd.missing_ok
        }
      end)

    index_cmds =
      table.indexes
      |> Enum.filter(&Catalog.depends_on_column?(&1, cmd.name))
      |> Enum.map(&%Schema.Update.DropIndex{names: [[table.name.schema, &1.name]]})

    {alter_table ++ index_cmds, table}
  end

  def update(%{node: {:alter_table_cmd, %{subtype: :AT_DropConstraint} = cmd}}, table) do
    constraint =
      Enum.find(table.constraints, fn %{constraint: {_tag, %{name: name}}} -> name == cmd.name end)

    if is_nil(constraint) && !cmd.missing_ok,
      do: raise("invalid constraint #{cmd.name} on table #{table.name}")

    # for the cascade operations we need info on the constraint that's being dropped
    # this is the easiest way i could think of to pass that on.. hacky
    {[
       %Schema.Update.DropConstraint{
         table: table.name,
         name: cmd.name,
         constraint: constraint,
         missing_ok: cmd.missing_ok
       }
     ], table}
  end

  def update(%{node: {:alter_table_cmd, %{subtype: :AT_AlterColumnType} = act}}, table) do
    %{def: %{node: {:column_def, def}}} = act

    {[],
     update_column(table, act.name, fn column -> %{column | type: AST.map(def.type_name)} end)}
  end

  def update(%{node: {:alter_table_cmd, %{subtype: :AT_SetNotNull} = act}}, table) do
    Logger.info("ALTER TABLE #{table.name} ALTER COLUMN #{act.name} SET NOT NULL")
    {[], update_column(table, act.name, &Schema.Update.ensure_not_null_constraint/1)}
  end

  def update(%{node: {:alter_table_cmd, %{subtype: :AT_DropNotNull} = act}}, table) do
    Logger.info("ALTER TABLE #{table.name} ALTER COLUMN #{act.name} DROP NOT NULL")
    # pg prevents removal of not-null constraint on pk columns
    {[],
     update_column(table, act.name, fn column ->
       %{
         column
         | constraints: Enum.reject(column.constraints, is_constraint(Proto.Constraint.NotNull))
       }
     end)}
  end

  def update(%{node: {:alter_table_cmd, %{subtype: :AT_AlterConstraint} = act}}, table) do
    %{def: %{node: {:constraint, con}}} = act
    Logger.info("ALTER TABLE #{table.name} ALTER CONSTRAINT #{con.conname} ... ")

    table =
      update_constraint(
        table,
        con.conname,
        fn %{constraint: {tag, c}} = constraint ->
          %{
            constraint
            | constraint: {tag, %{c | initdeferred: con.initdeferred, deferrable: con.deferrable}}
          }
        end,
        act.missing_ok
      )

    {[], table}
  end

  def update(%{node: {:alter_table_cmd, %{subtype: subtype} = act}}, table) do
    Logger.warn("Un-supported alter table statement on #{table.name} #{subtype}: #{inspect(act)}")
    {[], table}
  end

  defp is_constraint(type) do
    fn %Proto.Constraint{constraint: {_tag, c}} -> is_struct(c, type) end
  end

  defp cappend(obj, nil) do
    obj
  end

  defp cappend(obj, constraint) do
    %{obj | constraints: Schema.order(obj.constraints ++ [constraint])}
  end

  defp update_column_constraints(table, %Proto.Constraint{constraint: {:primary, pk}}) do
    Enum.reduce(pk.keys, table, fn key_col, table ->
      update_column(table, key_col, fn column ->
        Schema.Update.ensure_not_null_constraint(column)
      end)
    end)
  end

  defp update_column_constraints(table, _constraint) do
    table
  end

  def update_column(table, name, update_fun) do
    Schema.Update.update_in_place(table, :columns, name, update_fun, false)
  end

  def update_constraint(obj, name, update_fun, missing_ok) do
    Schema.Update.update_in_place(obj, :constraints, name, update_fun, missing_ok)
  end
end
