defmodule Electric.Postgres.Inspector.EtsInspectorTest do
  use Support.TransactionCase, async: true
  import Support.ComponentSetup
  import Support.DbStructureSetup
  alias Electric.Postgres.Inspector.EtsInspector

  describe "load_column_info/2" do
    setup [:with_inspector, :with_basic_tables]

    setup %{inspector: {EtsInspector, opts}} do
      {:ok, %{opts: opts, table: {"public", "items"}}}
    end

    test "returns column info for the table", %{opts: opts, table: table} do
      assert {:ok, [%{name: "id"}, %{name: "value"}]} = EtsInspector.load_column_info(table, opts)
    end

    test "returns same value from ETS cache as the original call", %{opts: opts, table: table} do
      original = EtsInspector.load_column_info(table, opts)
      from_cache = EtsInspector.load_column_info(table, opts)
      assert from_cache == original
    end

    test "returns same value from ETS cache as the original call with concurrent calls", %{
      opts: opts,
      table: table
    } do
      task = Task.async(fn -> EtsInspector.load_column_info(table, opts) end)
      original = EtsInspector.load_column_info(table, opts)
      from_cache = Task.await(task)
      assert from_cache == original
    end
  end
end
