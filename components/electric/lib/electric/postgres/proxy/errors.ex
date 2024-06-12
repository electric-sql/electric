defmodule Electric.Postgres.Proxy.Errors do
  alias Electric.Postgres.Schema.Proto

  import Electric.Utils, only: [inspect_relation: 1]

  def command_not_supported(command, query) do
    %{
      code: "EX001",
      message: "#{Electric.DDLX.Command.tag(command)} `#{query}`is currently unsupported",
      detail:
        "We are working on implementing access controls -- when these features are completed then this command will work",
      query: query
    }
  end

  def cannot_rename_table(query_analysis) do
    %{
      code: "EX002",
      message: ~s[Cannot rename electrified table #{sql_table(query_analysis)}]
    }
  end

  def cannot_rename_table_property(query_analysis) do
    %{
      code: "EX003",
      message: ~s[Cannot rename property of electrified table #{sql_table(query_analysis)}]
    }
  end

  def cannot_drop_electrified_table(query_analysis) do
    %{
      code: "EX004",
      message: ~s[Cannot drop electrified table #{sql_table(query_analysis)}]
    }
  end

  def cannot_electrify_column_type(type) do
    %{
      code: "EX005",
      message: "Cannot electrify column of type " <> inspect(type)
    }
  end

  def cannot_electrify_column_default do
    %{
      code: "EX006",
      message: "Cannot electrify column with DEFAULT clause"
    }
  end

  def cannot_alter_column(col_name, query_analysis) do
    %{
      code: "EX007",
      message:
        ~s[Cannot alter column "#{col_name}" of electrified table #{sql_table(query_analysis)}]
    }
  end

  def cannot_rename_column(col_name, query_analysis) do
    %{
      code: "EX008",
      message:
        ~s[Cannot rename column "#{col_name}" of electrified table #{sql_table(query_analysis)}]
    }
  end

  def cannot_change_column_type(col_name, query_analysis) do
    %{
      code: "EX009",
      message:
        ~s[Cannot change type of column "#{col_name}" of electrified table #{sql_table(query_analysis)}]
    }
  end

  def cannot_drop_electrified_column(col_name, query_analysis) do
    %{
      code: "EX010",
      message:
        ~s[Cannot drop column "#{col_name}" of electrified table #{sql_table(query_analysis)}]
    }
  end

  def cannot_electrify_constraint(constraint) do
    %{
      code: "EX011",
      message: "Cannot electrify column with #{format_constraint(constraint)} constraint"
    }
  end

  def cannot_rename_constraint(con_name, query_analysis) do
    %{
      code: "EX012",
      message:
        ~s[Cannot rename constraint "#{con_name}" of electrified table #{sql_table(query_analysis)}]
    }
  end

  def cannot_grant_write_permissions(table, reason) do
    %{
      code: "EX013",
      message: "Table #{table} does not support write permissions: #{reason}"
    }
  end

  def invalid_table_schema({sname, tname} = table) do
    %{
      code: "EX014",
      message:
        "Cannot electrify #{inspect_relation(table)} because only tables in the default `public` schema can be electrified." <>
          "\n\nSee https://electric-sql.com/docs/usage/data-modelling/migrations#limitations" <>
          "\nto learn more about the current limitations of electrified tables.",
      schema: sname,
      table: tname
    }
  end

  def no_primary_key({sname, tname} = table) do
    %{
      code: "EX015",
      message:
        "Cannot electrify #{inspect_relation(table)} because it does not have a primary key",
      schema: sname,
      table: tname
    }
  end

  def invalid_enum({_, _} = name, values) do
    %{
      code: "EX016",
      message:
        "Cannot electrify ENUM #{inspect_relation(name)} because it contains unsupported values: #{inspect(values)}"
    }
  end

  defp format_constraint(:CONSTR_CHECK), do: "CHECK"
  defp format_constraint(:CONSTR_FOREIGN), do: "FOREIGN KEY"
  defp format_constraint(:CONSTR_GENERATED), do: "GENERATED"
  defp format_constraint(:CONSTR_IDENTITY), do: "GENERATED"
  defp format_constraint(:CONSTR_PRIMARY), do: "PRIMARY KEY"
  defp format_constraint(:CONSTR_UNIQUE), do: "UNIQUE"

  defp format_constraint(%Proto.Constraint.Check{}), do: "CHECK"
  defp format_constraint(%Proto.Constraint.ForeignKey{}), do: "FOREIGN KEY"
  defp format_constraint(%Proto.Constraint.Generated{}), do: "GENERATED"
  defp format_constraint(%Proto.Constraint.Identity{}), do: "GENERATED"
  defp format_constraint(%Proto.Constraint.PrimaryKey{}), do: "PRIMARY KEY"
  defp format_constraint(%Proto.Constraint.Unique{}), do: "UNIQUE"

  defp format_constraint(other), do: to_string(other)

  def sql_table(%{table: {schema, table}}) do
    ~s["#{schema}"."#{table}"]
  end

  def sql_table(%{schema: sname, name: tname}) do
    ~s["#{sname}"."#{tname}"]
  end
end
