defmodule Support.OracleHarness.RestartStrategy.Graceful do
  @moduledoc """
  Graceful restart: cleanly stop the running `Electric.StackSupervisor` and
  start a fresh one with the same `stack_id`, storage and slot, so the new
  stack restores everything the old one persisted to disk.
  """
  @behaviour Support.OracleHarness.RestartStrategy

  @impl true
  def restart(ctx), do: Support.ComponentSetup.restart_complete_stack(ctx)
end
