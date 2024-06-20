defmodule Electric.DDLX.Command.Enable do
  alias Electric.DDLX.Command
  alias Electric.Postgres

  import Electric.DDLX.Parser.Build

  @type t() :: %__MODULE__{
          table_name: Postgres.relation()
        }

  @keys [
    :table_name
  ]

  @enforce_keys @keys

  defstruct @keys

  def build(params, opts, ddlx) do
    with {:ok, table_schema} <- fetch_attr(params, :table_schema, default_schema(opts)),
         {:ok, table_name} <- fetch_attr(params, :table_name) do
      {:ok,
       %Command{
         action: struct(__MODULE__, table_name: {table_schema, table_name}),
         stmt: ddlx,
         tables: [{table_schema, table_name}],
         tag: "ELECTRIC ENABLE"
       }}
    end
  end
end
