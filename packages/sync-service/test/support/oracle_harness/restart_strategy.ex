defmodule Support.OracleHarness.RestartStrategy do
  @moduledoc """
  Strategy for restarting the Electric stack part-way through an oracle test run.

  The oracle harness restarts the stack every `RESTART_SERVER_EVERY` batches to
  exercise recovery. This behaviour abstracts *how* that restart happens so the
  same test can cover several failure/deploy modes, selected with the
  `RESTART_TYPE` env var:

    - `graceful` (default) — clean `stop_supervised` then restart the same
      `stack_id`, restoring from disk. See `#{inspect(__MODULE__.Graceful)}`.
    - `brutal` — simulate a crash (`Process.exit(pid, :kill)`, no terminate
      callbacks) then recover the same `stack_id` from on-disk state. See
      `#{inspect(__MODULE__.Brutal)}`.
    - `rolling` — rolling deploy: a new stack boots and contends on the same
      Postgres replication slot via the advisory lock, then the old stack is
      gracefully stopped so the new one takes over. See
      `#{inspect(__MODULE__.RollingDeploy)}`.

  `restart/1` receives the current test `ctx` and returns a map that is merged
  back into `ctx`. At minimum it updates `:stack_supervisor`; the rolling
  strategy also swaps in a new `:stack_id`, `:storage`, `:client`, etc. so the
  harness reconnects its checkers to the new stack.
  """

  @callback restart(ctx :: map()) :: map()

  @spec for_type(String.t()) :: module()
  def for_type("graceful"), do: __MODULE__.Graceful
  def for_type("brutal"), do: __MODULE__.Brutal
  def for_type("rolling"), do: __MODULE__.RollingDeploy

  def for_type(other),
    do:
      raise(
        ArgumentError,
        "unknown RESTART_TYPE=#{inspect(other)} (expected \"graceful\", \"brutal\" or \"rolling\")"
      )
end
