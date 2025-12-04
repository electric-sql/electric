defmodule Electric.Replication.ShapeLogCollector.RegistratorTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  alias Electric.Replication.ShapeLogCollector.{Processor, Registrator}

  import Support.ComponentSetup
  import Support.TestUtils

  @shape_handle_1 "handle-1"
  @shape_handle_2 "handle-2"
  @shape_handle_3 "handle-3"
  @shape_1 "shape-1"
  @shape_2 "shape-2"
  @shape_3 "shape-3"

  setup :with_stack_id_from_test

  setup ctx do
    stack_id = ctx.stack_id

    registrator_pid =
      start_link_supervised!(
        {Registrator, stack_id: stack_id},
        id: {Registrator, stack_id}
      )

    test_pid = self()

    patch_calls(Processor,
      handle_shape_registration_updates: fn ^stack_id, shapes_to_add, shapes_to_remove ->
        ref = make_ref()
        delay = ctx[:processor_delay] || 0
        handles_to_fail = ctx[:processor_handle_result] || Map.new()

        results =
          Map.keys(shapes_to_add)
          |> Enum.concat(MapSet.to_list(shapes_to_remove))
          |> Map.new(fn handle -> {handle, Map.get(handles_to_fail, handle, :ok)} end)

        send(test_pid, {:processor_called, shapes_to_add, shapes_to_remove})

        Process.send_after(registrator_pid, {ref, {:ok, results}}, delay)

        Task.async(fn ->
          Process.sleep(delay)
          Registrator.handle_processor_update_response(stack_id, ref, results)
        end)

        ref
      end
    )

    Repatch.allow(self(), registrator_pid)

    :ok
  end

  describe "add_shape/4" do
    test "returns immediately for :restore mode", %{stack_id: stack_id} do
      assert :ok = Registrator.add_shape(stack_id, @shape_handle_1, @shape_1, :restore)
      refute_received {:processor_called, _, _}
    end

    test "updates processor for :create mode", %{stack_id: stack_id} do
      assert :ok = Registrator.add_shape(stack_id, @shape_handle_1, @shape_1, :create)

      expected_msg = {:processor_called, %{@shape_handle_1 => @shape_1}, MapSet.new()}
      assert_received ^expected_msg
    end

    @tag processor_handle_result: %{@shape_handle_1 => {:error, "failed to register"}}
    test "receives error if failed to register", %{stack_id: stack_id} do
      assert {:error, "failed to register"} =
               Registrator.add_shape(stack_id, @shape_handle_1, @shape_1, :create)
    end
  end

  describe "remove_shape/2" do
    test "updates processor to remove shape", %{stack_id: stack_id} do
      assert :ok = Registrator.add_shape(stack_id, @shape_handle_1, @shape_1, :create)

      expected_msg = {:processor_called, %{@shape_handle_1 => @shape_1}, MapSet.new()}
      assert_received ^expected_msg

      assert :ok = Registrator.remove_shape(stack_id, @shape_handle_1)

      expected_msg = {:processor_called, %{}, MapSet.new([@shape_handle_1])}
      assert_receive ^expected_msg

      # registrator will always repeat messages, no global state known
      assert :ok = Registrator.remove_shape(stack_id, @shape_handle_1)
      assert_receive ^expected_msg
    end
  end

  describe "batching behavior" do
    @tag processor_delay: 20
    test "add is invalidated if removal occurs before update is submitted", %{stack_id: stack_id} do
      task1 =
        Task.async(fn -> Registrator.add_shape(stack_id, @shape_handle_1, @shape_1, :create) end)

      expected_msg = {:processor_called, %{@shape_handle_1 => @shape_1}, MapSet.new()}
      assert_receive ^expected_msg

      test_pid = self()

      task2 =
        Task.async(fn ->
          send(test_pid, :adding_shape_2)
          Registrator.add_shape(stack_id, @shape_handle_2, @shape_2, :create)
        end)

      assert_receive :adding_shape_2
      assert :ok = Registrator.remove_shape(stack_id, @shape_handle_2)

      assert [:ok, {:error, "Shape #{@shape_handle_2} removed before registration completed"}] ==
               Task.await_many([task1, task2], 500)
    end

    @tag processor_delay: 20
    @tag processor_handle_result: %{@shape_handle_3 => {:error, "failed to register"}}
    test "waits for ack before sending next batch", %{stack_id: stack_id} do
      task1 =
        Task.async(fn -> Registrator.add_shape(stack_id, @shape_handle_1, @shape_1, :create) end)

      expected_msg = {:processor_called, %{@shape_handle_1 => @shape_1}, MapSet.new()}
      assert_receive ^expected_msg

      task2 =
        Task.async(fn -> Registrator.add_shape(stack_id, @shape_handle_2, @shape_2, :create) end)

      task3 =
        Task.async(fn -> Registrator.add_shape(stack_id, @shape_handle_3, @shape_3, :create) end)

      task4 =
        Task.async(fn -> Registrator.remove_shape(stack_id, @shape_handle_1) end)

      # should not call processor until acked
      Process.sleep(10)
      refute_received {:processor_called, _, _}
      assert :ok = Task.await(task1, 100)

      # should call processor immediately after with batched update
      expected_msg =
        {:processor_called, %{@shape_handle_2 => @shape_2, @shape_handle_3 => @shape_3},
         MapSet.new([@shape_handle_1])}

      assert_receive ^expected_msg

      assert [:ok, {:error, "failed to register"}, :ok] ==
               Task.await_many([task2, task3, task4], 500)
    end
  end
end
