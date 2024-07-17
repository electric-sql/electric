defmodule Support.TransactionCase do
  @moduledoc """
  Special test case that starts a DB connection, and runs entire test in
  a single Postgrex transaction, rolling it back completely after the test
  has ended.

  Exposes a context variable `conn` to run queries over.
  """
  use ExUnit.CaseTemplate
  import Support.DbSetup

  setup_all :with_shared_db
  setup :in_transaction
end
