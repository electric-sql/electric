defmodule Electric.Postgres.Proxy.Errors do
  def access_control_not_supported(command, query) do
    %{
      code: "EX001",
      message: "#{Electric.DDLX.Command.tag(command)} is currently unsupported",
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

  defp format_constraint(:CONSTR_CHECK), do: "CHECK"
  defp format_constraint(:CONSTR_GENERATED), do: "GENERATED"
  defp format_constraint(:CONSTR_FOREIGN), do: "FOREIGN KEY"
  defp format_constraint(:CONSTR_IDENTITY), do: "GENERATED"
  defp format_constraint(:CONSTR_PRIMARY), do: "PRIMARY KEY"
  defp format_constraint(:CONSTR_UNIQUE), do: "UNIQUE"
  defp format_constraint(other), do: to_string(other)

  def sql_table(%{table: {schema, table}}) do
    ~s["#{schema}"."#{table}"]
  end
end
