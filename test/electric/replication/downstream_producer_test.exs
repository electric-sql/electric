defmodule Electric.Replication.DownstreamProducerTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.DownstreamProducer
  @producer {:via, :gproc, {:n, :l, "producer"}}

  test "start_link/2 starts the producer" do
    assert {:ok, pid} =
      DownstreamProducer.start_link(DownstreamProducerMock, @producer)
    assert Process.alive?(pid)
  end

  test "connected?/2 returns true if connected, false otherwise" do
    {:ok, pid} =
      DownstreamProducer.start_link(DownstreamProducerMock, @producer)

    refute DownstreamProducer.connected?(DownstreamProducerMock, pid)

    DownstreamProducerMock.set_expected_producer_connected(pid, true)

    assert DownstreamProducer.connected?(DownstreamProducerMock, pid)
  end

  test "start_replication/3 calls start replication on producer" do
    {:ok, pid} =
      DownstreamProducer.start_link(DownstreamProducerMock, @producer)

    :erlang.trace(pid, true, [:receive])

    assert :ok = DownstreamProducer.start_replication(DownstreamProducerMock, pid, 1)

    assert_receive {:trace, ^pid, :receive, {:"$gen_call", _, {:start_replication, 1}}}
  end
end
