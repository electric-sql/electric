defmodule Electric.DDLX.Command.Error do
  alias Electric.DDLX.Command

  @type t() :: %__MODULE__{
          sql: String.t(),
          line: pos_integer(),
          position: pos_integer(),
          message: String.t()
        }

  @keys [
    :sql,
    :line,
    :position,
    :message
  ]

  @enforce_keys @keys

  defstruct @keys

  @behaviour Exception

  @impl Exception
  def blame(error, stacktrace) do
    {error, stacktrace}
  end

  @impl Exception
  def exception(args) do
    struct(__MODULE__, args)
  end

  @impl Exception
  def message(%__MODULE__{message: message}) do
    message
  end

  defimpl Command do
    def pg_sql(_) do
      []
    end

    def table_name(_) do
      ""
    end

    def tag(_), do: "ELECTRIC ERROR"

    def to_protobuf(_), do: []
  end
end
