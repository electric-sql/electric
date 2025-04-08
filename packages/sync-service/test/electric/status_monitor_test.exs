defmodule Electric.StatusMonitorTest do
  use ExUnit.Case, async: true

  alias Electric.StatusMonitor

  setup {Support.ComponentSetup, :with_stack_id_from_test}

  describe "status/1" do
    test "when not started, returns :waiting", %{stack_id: stack_id} do
      assert StatusMonitor.status(stack_id) == :waiting
    end

    test "when started but no signals have been received, returns :waiting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      assert StatusMonitor.status(stack_id) == :waiting
    end

    test "when pg_lock_acquired has been received, returns :starting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.pg_lock_acquired(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when all conditions are met, returns :active", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.pg_lock_acquired(stack_id)
      StatusMonitor.replication_client_ready(stack_id)
      StatusMonitor.connection_pool_ready(stack_id)
      assert StatusMonitor.status(stack_id) == :active
    end

    test "when replication client not ready, returns :starting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.pg_lock_acquired(stack_id)
      StatusMonitor.connection_pool_ready(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when connection pool not ready, returns :starting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.pg_lock_acquired(stack_id)
      StatusMonitor.replication_client_ready(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end
  end
end
