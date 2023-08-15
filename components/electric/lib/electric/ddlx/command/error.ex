defmodule Electric.DDLX.Command.Error do
  @type t() :: %__MODULE__{
          sql: String.t(),
          message: String.t()
        }

  @keys [
    :sql,
    :message
  ]

  @enforce_keys @keys

  defstruct @keys
end
