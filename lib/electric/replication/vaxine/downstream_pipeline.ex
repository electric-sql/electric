defmodule Electric.Replication.Postgres.DownstreamPipeline do
  use GenServer

  alias Electric.Replication.Postgres.SlotServer

  require Logger

  def start_link(args) do
    GenServer.start_link(__MODULE__, name: args.name, args: args)
  end

  def init(opts) do
    args = Keyword.fetch!(opts, :args)
    {:ok, producer_pid} = args.downstream.producer.start_link(args.downstream.producer_opts)

    {:ok, slot_server_pid} =
      SlotServer.start_link(
        slot: args.replication.subscription,
        producer: args.downstream.producer,
        producer_pid: producer_pid
      )

    {:ok, %{producer_pid: producer_pid, slot_server_pid: slot_server_pid}}
  end

  def connected?(pid) do
    GenServer.call(pid, :connected?)
  end

  def handle_call(:connected?, _from, state) do
    {:reply, GenStage.call(state.producer_pid, :connected?), state}
  end
end
