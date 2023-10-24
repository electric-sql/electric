defmodule Electric.DDLX.Command.Enable do
  alias Electric.DDLX.Command
  import Electric.DDLX.Parse.Build

  @type t() :: %__MODULE__{
          table_name: String.t()
        }

  @keys [
    :table_name
  ]

  @enforce_keys @keys

  defstruct @keys

  def build(params, opts) do
    with {:ok, table_schema} <- fetch_attr(params, :table_schema, default_schema(opts)),
         {:ok, table_name} <- fetch_attr(params, :table_name) do
      {:ok, struct(__MODULE__, table_name: {table_schema, table_name})}
    end
  end

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(enable) do
      [
        """
        CALL electric.enable(#{sql_repr(enable.table_name)});
        """
      ]
    end

    def table_name(%{table_name: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC ENABLE"
  end
end
