defmodule Electric.Postgres.Extension.Migration do
  @callback version() :: pos_integer()
  @callback up(binary()) :: [binary(), ...]
  @callback down(binary()) :: [binary()]
end
