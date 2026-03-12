defmodule Electric.StackSupervisorTest do
  use ExUnit.Case, async: true

  alias Electric.StackSupervisor

  import Support.ComponentSetup

  describe "Telemetry" do
    setup [:with_stack_id_from_test]

    test "default_periodic_measurements/1 do not raise if stack down", ctx do
      for {m, f, a} <-
            StackSupervisor.Telemetry.default_periodic_measurements(%{
              stack_id: ctx.stack_id,
              replication_opts: [slot_name: "no_such_slot"]
            }) do
        apply(m, f, a ++ [%{}])
      end
    end
  end
end
