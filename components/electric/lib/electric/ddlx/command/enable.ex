defmodule Electric.DDLX.Command.Enable do
  alias Electric.DDLX.Command

  @type t() :: %__MODULE__{
          table_name: String.t()
        }

  @keys [
    :table_name
  ]

  @enforce_keys @keys

  defstruct @keys

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(enable) do
      [
        """
        SELECT electric.enable(#{sql_repr(enable.table_name)});
        """
      ]
    end

    def table_name(%{table_name: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC ENABLE"
  end
end
