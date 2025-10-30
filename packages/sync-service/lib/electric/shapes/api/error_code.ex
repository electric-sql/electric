defmodule Electric.Shapes.Api.ErrorCode do
  @moduledoc """
  Structured error codes for Electric Shape API responses.

  Error codes provide machine-readable identifiers for different error scenarios,
  enabling clients to implement proper retry logic and error handling without
  parsing error message strings.
  """

  @type error_code ::
          # Stack initialization/availability errors
          :stack_not_ready
          | :stack_pg_lock_timeout
          | :stack_replication_client_timeout
          | :stack_admin_pool_timeout
          | :stack_snapshot_pool_timeout
          | :stack_shape_collector_timeout
          | :stack_supervisor_restart_timeout
          | :stack_not_found
          | :stack_terminated
          | :stack_connection_sleeping
          | :stack_unknown_timeout
          | :stack_database_unavailable

  @type error_info :: %{
          code: String.t(),
          component: String.t() | nil,
          retryable: boolean(),
          backoff_ms: pos_integer() | nil,
          category: :stack_unavailable | :client_error | :server_error
        }

  # Stack availability error codes
  # These indicate the Electric stack is not ready to serve requests

  @doc """
  Timeout waiting for Postgres advisory lock acquisition.

  This usually indicates another Electric instance is running with the same
  configuration, or the lock is being held by a terminated process.
  """
  def stack_pg_lock_timeout do
    %{
      code: "STACK_PG_LOCK_TIMEOUT",
      component: "pg_lock",
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Timeout waiting for replication client to become ready.

  This often indicates pending transactions in the database that need to
  commit or rollback before Electric can create the replication slot.
  """
  def stack_replication_client_timeout do
    %{
      code: "STACK_REPLICATION_CLIENT_TIMEOUT",
      component: "replication_client",
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Timeout waiting for admin/metadata database connection pool to become ready.

  This indicates Electric cannot establish connections to the database for
  metadata operations.
  """
  def stack_admin_pool_timeout do
    %{
      code: "STACK_ADMIN_POOL_TIMEOUT",
      component: "admin_connection_pool",
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Timeout waiting for snapshot database connection pool to become ready.

  This indicates Electric cannot establish connections to the database for
  snapshot operations.
  """
  def stack_snapshot_pool_timeout do
    %{
      code: "STACK_SNAPSHOT_POOL_TIMEOUT",
      component: "snapshot_connection_pool",
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Timeout waiting for shape log collector to load data.

  This indicates the shape cache subsystem is not ready to serve requests.
  """
  def stack_shape_collector_timeout do
    %{
      code: "STACK_SHAPE_COLLECTOR_TIMEOUT",
      component: "shape_log_collector",
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Timeout waiting for stack supervisor processes to restart.

  This indicates the Electric stack is restarting and not yet ready.
  """
  def stack_supervisor_restart_timeout do
    %{
      code: "STACK_SUPERVISOR_RESTART_TIMEOUT",
      component: "supervisor_processes",
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Stack status monitor process not found.

  This indicates the Electric stack has not started yet or has been terminated.
  """
  def stack_not_found do
    %{
      code: "STACK_NOT_FOUND",
      component: "status_monitor",
      retryable: true,
      backoff_ms: 5000,
      category: :stack_unavailable
    }
  end

  @doc """
  Stack process has terminated.

  This indicates the Electric stack has been shut down or crashed.
  """
  def stack_terminated do
    %{
      code: "STACK_TERMINATED",
      component: nil,
      retryable: true,
      backoff_ms: 5000,
      category: :stack_unavailable
    }
  end

  @doc """
  Database connections are sleeping (scaled to zero).

  This indicates the Electric stack has scaled down database connections to save
  resources. The connection subsystem will automatically restart.
  """
  def stack_connection_sleeping do
    %{
      code: "STACK_CONNECTION_SLEEPING",
      component: "database_connections",
      retryable: true,
      backoff_ms: 1000,
      category: :stack_unavailable
    }
  end

  @doc """
  Generic stack not ready error.

  This is used when the specific component that is not ready cannot be determined,
  or when a custom timeout message was set.
  """
  def stack_not_ready do
    %{
      code: "STACK_NOT_READY",
      component: nil,
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Unknown stack timeout.

  This is used when a timeout occurs but the specific condition cannot be identified.
  """
  def stack_unknown_timeout do
    %{
      code: "STACK_UNKNOWN_TIMEOUT",
      component: nil,
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Database connection not available for shape validation.

  This indicates Electric cannot connect to the database to validate the shape
  definition (e.g., verify table exists, check columns).
  """
  def stack_database_unavailable do
    %{
      code: "STACK_DATABASE_UNAVAILABLE",
      component: "database_inspector",
      retryable: true,
      backoff_ms: 2000,
      category: :stack_unavailable
    }
  end

  @doc """
  Convert an error code atom to its error info map.
  """
  @spec get_info(error_code()) :: error_info()
  def get_info(:stack_pg_lock_timeout), do: stack_pg_lock_timeout()
  def get_info(:stack_replication_client_timeout), do: stack_replication_client_timeout()
  def get_info(:stack_admin_pool_timeout), do: stack_admin_pool_timeout()
  def get_info(:stack_snapshot_pool_timeout), do: stack_snapshot_pool_timeout()
  def get_info(:stack_shape_collector_timeout), do: stack_shape_collector_timeout()
  def get_info(:stack_supervisor_restart_timeout), do: stack_supervisor_restart_timeout()
  def get_info(:stack_not_found), do: stack_not_found()
  def get_info(:stack_terminated), do: stack_terminated()
  def get_info(:stack_connection_sleeping), do: stack_connection_sleeping()
  def get_info(:stack_not_ready), do: stack_not_ready()
  def get_info(:stack_unknown_timeout), do: stack_unknown_timeout()
  def get_info(:stack_database_unavailable), do: stack_database_unavailable()

  @doc """
  Determine the error code from StatusMonitor timeout results.

  Returns an error code atom based on which component failed to become ready.
  """
  @spec from_timeout_results(map()) :: error_code()
  def from_timeout_results(%{pg_lock_acquired: {false, _}}), do: :stack_pg_lock_timeout

  def from_timeout_results(%{replication_client_ready: {false, _}}),
    do: :stack_replication_client_timeout

  def from_timeout_results(%{admin_connection_pool_ready: {false, _}}),
    do: :stack_admin_pool_timeout

  def from_timeout_results(%{snapshot_connection_pool_ready: {false, _}}),
    do: :stack_snapshot_pool_timeout

  def from_timeout_results(%{shape_log_collector_ready: {false, _}}),
    do: :stack_shape_collector_timeout

  def from_timeout_results(%{supervisor_processes_ready: {false, _}}),
    do: :stack_supervisor_restart_timeout

  # Custom timeout message was set
  def from_timeout_results(%{timeout_message: _}), do: :stack_not_ready

  # Fallback for unknown conditions
  def from_timeout_results(_), do: :stack_unknown_timeout
end
