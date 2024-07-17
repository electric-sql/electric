defmodule PgInterop.Interval.PostgresAndSQLParserTest do
  use ExUnit.Case, async: true
  alias PgInterop.Interval
  doctest PgInterop.Interval.PostgresAndSQLParser, import: true
end
