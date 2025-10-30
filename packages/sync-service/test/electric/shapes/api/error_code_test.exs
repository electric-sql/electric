defmodule Electric.Shapes.Api.ErrorCodeTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Api.ErrorCode

  describe "error code information" do
    test "stack_pg_lock_timeout returns correct info" do
      info = ErrorCode.stack_pg_lock_timeout()

      assert info.code == "STACK_PG_LOCK_TIMEOUT"
      assert info.component == "pg_lock"
      assert info.retryable == true
      assert info.backoff_ms == 2000
      assert info.category == :stack_unavailable
    end

    test "stack_replication_client_timeout returns correct info" do
      info = ErrorCode.stack_replication_client_timeout()

      assert info.code == "STACK_REPLICATION_CLIENT_TIMEOUT"
      assert info.component == "replication_client"
      assert info.retryable == true
    end

    test "stack_admin_pool_timeout returns correct info" do
      info = ErrorCode.stack_admin_pool_timeout()

      assert info.code == "STACK_ADMIN_POOL_TIMEOUT"
      assert info.component == "admin_connection_pool"
      assert info.retryable == true
    end

    test "stack_snapshot_pool_timeout returns correct info" do
      info = ErrorCode.stack_snapshot_pool_timeout()

      assert info.code == "STACK_SNAPSHOT_POOL_TIMEOUT"
      assert info.component == "snapshot_connection_pool"
      assert info.retryable == true
    end

    test "stack_shape_collector_timeout returns correct info" do
      info = ErrorCode.stack_shape_collector_timeout()

      assert info.code == "STACK_SHAPE_COLLECTOR_TIMEOUT"
      assert info.component == "shape_log_collector"
      assert info.retryable == true
    end

    test "stack_supervisor_restart_timeout returns correct info" do
      info = ErrorCode.stack_supervisor_restart_timeout()

      assert info.code == "STACK_SUPERVISOR_RESTART_TIMEOUT"
      assert info.component == "supervisor_processes"
      assert info.retryable == true
    end

    test "stack_not_found returns correct info" do
      info = ErrorCode.stack_not_found()

      assert info.code == "STACK_NOT_FOUND"
      assert info.component == "status_monitor"
      assert info.retryable == true
      assert info.backoff_ms == 5000
    end

    test "stack_terminated returns correct info" do
      info = ErrorCode.stack_terminated()

      assert info.code == "STACK_TERMINATED"
      assert info.component == nil
      assert info.retryable == true
    end

    test "stack_connection_sleeping returns correct info" do
      info = ErrorCode.stack_connection_sleeping()

      assert info.code == "STACK_CONNECTION_SLEEPING"
      assert info.component == "database_connections"
      assert info.retryable == true
      assert info.backoff_ms == 1000
    end

    test "stack_database_unavailable returns correct info" do
      info = ErrorCode.stack_database_unavailable()

      assert info.code == "STACK_DATABASE_UNAVAILABLE"
      assert info.component == "database_inspector"
      assert info.retryable == true
    end

    test "stack_not_ready returns correct info" do
      info = ErrorCode.stack_not_ready()

      assert info.code == "STACK_NOT_READY"
      assert info.component == nil
      assert info.retryable == true
    end

    test "stack_unknown_timeout returns correct info" do
      info = ErrorCode.stack_unknown_timeout()

      assert info.code == "STACK_UNKNOWN_TIMEOUT"
      assert info.retryable == true
    end
  end

  describe "get_info/1" do
    test "returns correct info for all error code atoms" do
      assert ErrorCode.get_info(:stack_pg_lock_timeout) == ErrorCode.stack_pg_lock_timeout()

      assert ErrorCode.get_info(:stack_replication_client_timeout) ==
               ErrorCode.stack_replication_client_timeout()

      assert ErrorCode.get_info(:stack_admin_pool_timeout) ==
               ErrorCode.stack_admin_pool_timeout()

      assert ErrorCode.get_info(:stack_snapshot_pool_timeout) ==
               ErrorCode.stack_snapshot_pool_timeout()

      assert ErrorCode.get_info(:stack_shape_collector_timeout) ==
               ErrorCode.stack_shape_collector_timeout()

      assert ErrorCode.get_info(:stack_supervisor_restart_timeout) ==
               ErrorCode.stack_supervisor_restart_timeout()

      assert ErrorCode.get_info(:stack_not_found) == ErrorCode.stack_not_found()
      assert ErrorCode.get_info(:stack_terminated) == ErrorCode.stack_terminated()

      assert ErrorCode.get_info(:stack_connection_sleeping) ==
               ErrorCode.stack_connection_sleeping()

      assert ErrorCode.get_info(:stack_not_ready) == ErrorCode.stack_not_ready()
      assert ErrorCode.get_info(:stack_unknown_timeout) == ErrorCode.stack_unknown_timeout()

      assert ErrorCode.get_info(:stack_database_unavailable) ==
               ErrorCode.stack_database_unavailable()
    end
  end

  describe "from_timeout_results/1" do
    test "returns correct error code for pg_lock_acquired failure" do
      results = %{pg_lock_acquired: {false, %{}}}
      assert ErrorCode.from_timeout_results(results) == :stack_pg_lock_timeout
    end

    test "returns correct error code for replication_client_ready failure" do
      results = %{replication_client_ready: {false, %{}}}
      assert ErrorCode.from_timeout_results(results) == :stack_replication_client_timeout
    end

    test "returns correct error code for admin_connection_pool_ready failure" do
      results = %{admin_connection_pool_ready: {false, %{}}}
      assert ErrorCode.from_timeout_results(results) == :stack_admin_pool_timeout
    end

    test "returns correct error code for snapshot_connection_pool_ready failure" do
      results = %{snapshot_connection_pool_ready: {false, %{}}}
      assert ErrorCode.from_timeout_results(results) == :stack_snapshot_pool_timeout
    end

    test "returns correct error code for shape_log_collector_ready failure" do
      results = %{shape_log_collector_ready: {false, %{}}}
      assert ErrorCode.from_timeout_results(results) == :stack_shape_collector_timeout
    end

    test "returns correct error code for supervisor_processes_ready failure" do
      results = %{supervisor_processes_ready: {false, %{}}}
      assert ErrorCode.from_timeout_results(results) == :stack_supervisor_restart_timeout
    end

    test "returns stack_not_ready for custom timeout message" do
      results = %{timeout_message: "Custom error message"}
      assert ErrorCode.from_timeout_results(results) == :stack_not_ready
    end

    test "returns stack_unknown_timeout for unknown results" do
      results = %{some_unknown_condition: {false, %{}}}
      assert ErrorCode.from_timeout_results(results) == :stack_unknown_timeout
    end
  end

  describe "all error codes are retryable and have correct categories" do
    test "all stack unavailability errors are retryable and categorized correctly" do
      error_codes = [
        :stack_pg_lock_timeout,
        :stack_replication_client_timeout,
        :stack_admin_pool_timeout,
        :stack_snapshot_pool_timeout,
        :stack_shape_collector_timeout,
        :stack_supervisor_restart_timeout,
        :stack_not_found,
        :stack_terminated,
        :stack_connection_sleeping,
        :stack_not_ready,
        :stack_unknown_timeout,
        :stack_database_unavailable
      ]

      for error_code <- error_codes do
        info = ErrorCode.get_info(error_code)
        assert info.retryable == true, "#{error_code} should be retryable"
        assert info.category == :stack_unavailable, "#{error_code} should be stack_unavailable"
        assert is_binary(info.code), "#{error_code} should have a string code"
        assert is_integer(info.backoff_ms) and info.backoff_ms > 0,
               "#{error_code} should have positive backoff_ms"
      end
    end
  end
end
