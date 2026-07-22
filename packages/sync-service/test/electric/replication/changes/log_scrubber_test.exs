defmodule Electric.Replication.Changes.LogScrubberTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.LogScrubber
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TransactionFragment

  doctest LogScrubber, import: true

  defp fragment(xid),
    do: %TransactionFragment{xid: xid, lsn: %Lsn{segment: 0, offset: 0}, change_count: 1}

  describe "scrub/1" do
    test "replaces events nested at arbitrary depth, leaving the structure intact" do
      reason = {:noproc, {GenServer, :call, [:pid, {:handle_event, fragment(99)}, 5000]}}

      assert {:noproc, {GenServer, :call, [:pid, {:handle_event, summary}, 5000]}} =
               LogScrubber.scrub(reason)

      assert summary == "#<transaction fragment xid=99 lsn=0/0 changes=1>"
    end

    test "scrubs events embedded in an improper list without crashing" do
      assert [:a | "#<transaction fragment xid=1 lsn=0/0 changes=1>"] =
               LogScrubber.scrub([:a | fragment(1)])
    end

    test "scrubs events in map keys and values" do
      assert %{"#<transaction fragment xid=2 lsn=0/0 changes=1>" => :v, k: summary} =
               LogScrubber.scrub(%{fragment(2) => :v, k: fragment(3)})

      assert summary == "#<transaction fragment xid=3 lsn=0/0 changes=1>"
    end

    test "leaves non-event structs untouched and does not recurse into their fields" do
      # an event hidden in a non-event struct's field is NOT scrubbed by design
      wrapper = %RuntimeError{message: "boom"}
      assert ^wrapper = LogScrubber.scrub(wrapper)
    end

    test "passes scalar and event-free terms through unchanged" do
      assert {:error, :not_ready} = LogScrubber.scrub({:error, :not_ready})
      assert :noproc = LogScrubber.scrub(:noproc)
    end
  end

  describe "summarize/1" do
    test "summarizes a Relation by schema/table/oid" do
      rel = %Relation{id: 16384, schema: "public", table: "items"}
      assert LogScrubber.summarize(rel) == ~S|relation "public"."items" (oid 16384)|
    end
  end

  describe "inspect_scrubbed/1" do
    test "returns a bounded string with events collapsed and row data absent" do
      event = %{
        fragment(7)
        | changes: [%{"value" => String.duplicate("secret", 10_000)}]
      }

      out = LogScrubber.inspect_scrubbed({:noproc, [event]})

      assert out == ~S|{:noproc, ["#<transaction fragment xid=7 lsn=0/0 changes=1>"]}|
      refute out =~ "secret"
    end
  end
end
