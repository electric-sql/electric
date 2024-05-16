defmodule Electric.DDLX.Command.Error do
  @type t() :: %__MODULE__{
          sql: String.t(),
          line: pos_integer(),
          position: pos_integer(),
          message: String.t()
        }

  @enforce_keys [:sql, :message]

  defstruct [
    :sql,
    :message,
    :code,
    line: 0,
    position: 0
  ]

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
end
