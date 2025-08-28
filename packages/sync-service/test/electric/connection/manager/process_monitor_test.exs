defmodule Electric.Connection.Manager.ProcessMonitorTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup

  setup [
    :with_stack_id_from_test
  ]

  test "proxies DOWN messages to connection manager", %{stack_id: stack_id} do
    parent = self()

    _connection_manager =
      spawn_link(fn ->
        # register this process as the connection manager for this stack
        {:via, mod, name} = Electric.Connection.Manager.name(stack_id)
        :yes = mod.register_name(name, self())

        send(parent, {:connection_manager, :ready})

        receive do
          {:process_monitored, _module, _pid, _ref} = msg ->
            send(parent, {:connection_manager, msg})
        end

        receive do
          msg -> send(parent, {:connection_manager, msg})
        end
      end)

    assert_receive {:connection_manager, :ready}

    assert Electric.Connection.Manager.name(stack_id) |> GenServer.whereis() |> is_pid()

    {:ok, _monitor} = Electric.Connection.Manager.ProcessMonitor.start_link(stack_id)

    child_pid =
      spawn_link(fn ->
        Electric.Connection.Manager.monitor(stack_id, __MODULE__, self())
        send(parent, {:child, :ready})

        receive do
          :stop -> :bye
        end
      end)

    assert_receive {:child, :ready}
    assert_receive {:connection_manager, {:process_monitored, __MODULE__, ^child_pid, _ref}}

    send(child_pid, :stop)

    assert_receive {:connection_manager, {:DOWN, _ref, :process, ^child_pid, _}}
  end
end
