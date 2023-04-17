defmodule Electric.Replication.Vaxine.LogConsumerTest do
  use ExUnit.Case

  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Vaxine.LogConsumer
  alias Electric.Replication.Vaxine

  use ExUnit.Case, async: false

  import Mock

  defmodule TestProducer do
    use GenStage

    def send_msg(pid, msg) do
      GenStage.call(pid, msg)
    end

    def start_link(args) do
      GenStage.start_link(__MODULE__, args)
    end

    @impl true
    def init([test_pid, reg_name, counter]) do
      true = Electric.safe_reg(reg_name, 1000)
      {:producer, {test_pid, counter}}
    end

    @impl true
    def handle_call(msg, _from, {test_pid, counter}) do
      {:reply, :ok,
       [
         %Transaction{
           ack_fn: fn ->
             send(test_pid, {self(), {msg, counter + 1}})
             :ok
           end,
           origin: __MODULE__,
           publication: __MODULE__,
           changes: [__MODULE__]
         }
       ], {test_pid, counter + +1}}
    end

    @impl true
    def handle_demand(_demand, state) do
      # We don't care about the demand
      {:noreply, [], state}
    end

    @impl true
    def handle_subscribe(:consumer, _opts, from, state = {test_pid, _counter}) do
      send(test_pid, {self(), {:subscribe, from}})
      {:automatic, state}
    end
  end

  setup_with_mocks([
    {Vaxine, [],
     [
       transaction_to_vaxine: fn _tx, _pub -> :ok end
     ]}
  ]) do
    {:ok, %{}}
  end

  @default_wait 500

  describe "Test that consumer resubscribes to producer" do
    test "common flow" do
      producer_name = Electric.name(__MODULE__, 1)

      consumer_pid =
        start_supervised!(%{
          :id => LogConsumer,
          :start => {LogConsumer, :start_link, ["flow", producer_name]}
        })

      producer_pid = start_supervised!({TestProducer, [self(), producer_name, 0]})
      assert_receive {^producer_pid, {:subscribe, _}}, @default_wait
      TestProducer.send_msg(producer_pid, :msg)
      assert_receive {^consumer_pid, {:msg, 1}}

      stop_supervised!(TestProducer)

      producer_pid = start_supervised!({TestProducer, [self(), producer_name, 0]})
      assert_receive {^producer_pid, {:subscribe, _}}, @default_wait
      TestProducer.send_msg(producer_pid, :msg)
      assert_receive {^consumer_pid, {:msg, 1}}
    end
  end
end
