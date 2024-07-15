defmodule Electric.Replication.LogOffsetTest do
  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset

  use ExUnit.Case, async: true

  doctest Electric.Replication.LogOffset, import: true
end
