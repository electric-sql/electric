defmodule Electric.DDLX.Command.Disable do
  alias Electric.DDLX.Command

  import Electric.DDLX.Parser.Build

  @type t() :: %__MODULE__{
          table_name: String.t()
        }

  @keys [
    :table_name
  ]

  @enforce_keys @keys

  defstruct @keys

  def build(params, opts, ddlx) do
    with {:ok, table_schema} <- fetch_attr(params, :table_schema, default_schema(opts)),
         {:ok, table_name} <- fetch_attr(params, :table_name) do
      {:ok, struct(__MODULE__, table_name: {table_schema, table_name})}

      {:ok,
       %Command{
         cmds: struct(__MODULE__, table_name: {table_schema, table_name}),
         stmt: ddlx,
         tables: [{table_schema, table_name}],
         tag: "ELECTRIC DISABLE"
       }}
    end
  end

  defimpl Command.PgSQL do
    import Electric.DDLX.Command.Common

    def to_sql(disable) do
      [
        """
        CALL electric.disable(#{sql_repr(disable.table_name)});
        """
      ]
    end
  end
end
