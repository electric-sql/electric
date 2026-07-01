defmodule Support.OracleHarness.RestartStrategy.RollingDeploy do
  @moduledoc """
  Rolling deploy: bring up a brand new stack (its own `stack_id`, storage and
  HTTP server) that contends on the *same* Postgres replication slot as the
  running stack via the advisory lock. The new stack boots to `read_only`
  (blocked acquiring the lock the old stack holds), then the old stack is
  gracefully stopped — releasing the lock and leaving the persistent slot and
  publication in place — and the new stack takes over as the single active
  writer. Faithful to how Electric-cloud performs zero-downtime deploys.
  """
  @behaviour Support.OracleHarness.RestartStrategy

  @impl true
  def restart(ctx), do: Support.ComponentSetup.rolling_restart_complete_stack(ctx)
end
