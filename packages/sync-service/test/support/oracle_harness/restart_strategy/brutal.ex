defmodule Support.OracleHarness.RestartStrategy.Brutal do
  @moduledoc """
  Brutal restart: kill the running stack outright (`Process.exit(pid, :kill)`,
  no terminate callbacks, possibly mid-write) then bring a fresh stack back up
  on the same `stack_id`/storage. Exercises crash recovery — stale advisory
  lock, torn on-disk log, orphaned replication slot.
  """
  @behaviour Support.OracleHarness.RestartStrategy

  @impl true
  def restart(ctx), do: Support.ComponentSetup.brutally_restart_complete_stack(ctx)
end
