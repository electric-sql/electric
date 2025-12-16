defmodule Electric.Replication.ShapeLogCollector.SupervisorTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup

  alias Electric.Replication.ShapeLogCollector

  @inspector Support.StubInspector.new(
               tables: [{1234, {"public", "test_table"}}],
               columns: [%{name: "id", type: "int8", pk_position: 0}]
             )

  @moduletag :tmp_dir

  setup [
    :with_stack_id_from_test,
    :with_in_memory_storage,
    :with_shape_status,
    :with_lsn_tracker,
    :with_persistent_kv
  ]

  setup ctx do
    {:ok, pid} =
      start_supervised(
        Supervisor.child_spec(
          {ShapeLogCollector.Supervisor,
           stack_id: ctx.stack_id,
           inspector: {Mock.Inspector, elem(@inspector, 1)},
           persistent_kv: ctx.persistent_kv},
          restart: :temporary
        )
      )

    ref = Process.monitor(pid)

    %{monitor_ref: ref}
  end

  test "shuts down when processor is shut down normally", %{monitor_ref: ref} = ctx do
    ctx.stack_id |> ShapeLogCollector.name() |> GenServer.stop()
    assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000
  end

  test "shuts down when processor is shut down abnormally", %{monitor_ref: ref} = ctx do
    ctx.stack_id |> ShapeLogCollector.name() |> GenServer.stop(:whatever)
    assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000
  end

  test "shuts down when registrator is shut down normally", %{monitor_ref: ref} = ctx do
    ctx.stack_id |> ShapeLogCollector.name() |> GenServer.stop()
    assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000
  end

  test "shuts down when registrator is shut down abnormally", %{monitor_ref: ref} = ctx do
    ctx.stack_id |> ShapeLogCollector.name() |> GenServer.stop(:whatever)
    assert_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000
  end
end
