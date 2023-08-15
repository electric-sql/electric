defmodule Electric.DDLX.Command.SQLite do
  alias Electric.DDLX.Command

  @type t() :: %__MODULE__{
          sqlite_statement: String.t()
        }

  @keys [
    :sqlite_statement
  ]

  @enforce_keys @keys

  defstruct @keys

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(sqlite) do
      [
        """
        SELECT electric.sqlite(sql => #{sql_repr(sqlite.sqlite_statement)});
        """
      ]
    end

    def table_name(_) do
      ""
    end

    def tag(_) do
      ""
    end
  end
end
