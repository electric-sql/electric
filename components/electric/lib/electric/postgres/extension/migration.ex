defmodule Electric.Postgres.Extension.Migration do
  @callback version() :: pos_integer()
  @callback up(binary()) :: [binary(), ...]
  @callback published_tables() :: [Electric.Postgres.relation()]
  @callback replicated_table_ddls() :: [String.t()]
  @optional_callbacks replicated_table_ddls: 0, published_tables: 0

  @enforce_keys [:version, :schema, :stmts, :txid, :txts, :timestamp]

  defstruct [:version, :schema, :stmts, :txid, :txts, :timestamp]

  @type t :: %__MODULE__{
          version: binary(),
          schema: Electric.Postgres.Schema.t(),
          stmts: [binary()],
          timestamp: DateTime.t(),
          txid: integer(),
          txts: integer()
        }
end
