defmodule Electric.Postgres.Extension.Migration do
  @callback version() :: pos_integer()
  @callback up(binary()) :: [binary(), ...]
  @callback down(binary()) :: [binary()]

  @enforce_keys [:version, :schema, :stmts, :txid, :txts]

  defstruct [:version, :schema, :stmts, :txid, :txts]

  @type t :: %__MODULE__{
          version: binary(),
          schema: Electric.Postgres.Schema.t(),
          stmts: [binary()],
          txid: integer(),
          txts: DateTime.t()
        }
end
