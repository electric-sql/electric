defmodule Electric.DDLX.Command.SQLite do
  alias Electric.DDLX.Command

  import Electric.DDLX.Parse.Build

  @type t() :: %__MODULE__{
          sqlite_statement: String.t()
        }

  @keys [
    :sqlite_statement
  ]

  @enforce_keys @keys

  defstruct @keys

  def build(params, _opts) do
    with {:ok, stmt} <- fetch_attr(params, :statement) do
      {:ok, %__MODULE__{sqlite_statement: stmt}}
    end
  end

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(sqlite) do
      [
        """
        CALL electric.sqlite(sql => #{sql_repr(sqlite.sqlite_statement)});
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
