defmodule Electric.Replication.ShapeLogCollectorTest do
  use ExUnit.Case, async: true

  import Mox

  alias Electric.Postgres.Lsn
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  alias Support.Mock

  @moduletag :capture_log

  setup :verify_on_exit!

  describe "store_transaction/2" do
    setup do
      # Start a test Registry
      registry_name = Module.concat(__MODULE__, Registry)
      start_link_supervised!({Registry, keys: :duplicate, name: registry_name})

      # Start the ShapeLogCollector process
      opts = [
        name: __MODULE__.ShapeLogCollector,
        inspector: {Mock.Inspector, []}
      ]

      {:ok, pid} = start_supervised({ShapeLogCollector, opts})
      parent = self()

      consumers =
        Enum.map(1..3, fn id ->
          {:ok, consumer} =
            Support.TransactionConsumer.start_link(id: id, parent: parent, producer: pid)

          {id, consumer}
        end)

      %{server: pid, registry: registry_name, consumers: consumers}
    end

    test "broadcasts keyed changes to consumers", ctx do
      xmin = 100
      xid = 150
      lsn = Lsn.from_string("0/10")
      last_log_offset = LogOffset.new(lsn, 0)

      Mock.Inspector
      |> expect(:load_column_info, 2, fn {"public", "test_table"}, _ ->
        {:ok, [%{pk_position: 0, name: "id"}]}
      end)
      |> allow(self(), ctx.server)

      txn =
        %Transaction{xid: xmin, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "1"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn, ctx.server)

      xids =
        Support.TransactionConsumer.assert_consume(ctx.consumers, [txn])

      assert xids == [xmin]

      txn2 =
        %Transaction{xid: xid, lsn: lsn, last_log_offset: last_log_offset}
        |> Transaction.prepend_change(%Changes.NewRecord{
          relation: {"public", "test_table"},
          record: %{"id" => "2"}
        })

      assert :ok = ShapeLogCollector.store_transaction(txn2, ctx.server)

      xids = Support.TransactionConsumer.assert_consume(ctx.consumers, [txn2])

      assert xids == [xid]
    end
  end
end
