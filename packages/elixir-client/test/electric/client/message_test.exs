defmodule Electric.Client.MessageTest do
  use ExUnit.Case, async: true

  alias Electric.Client.Message
  alias Electric.Client.Message.ControlMessage

  describe "ControlMessage" do
    test "up-to-date" do
      assert [%ControlMessage{control: :up_to_date}] =
               Message.parse(%{"headers" => %{"control" => "up-to-date"}}, "handle", & &1)

      assert [%ControlMessage{control: :up_to_date}] =
               Message.parse(%{headers: %{control: "up-to-date"}}, "handle", & &1)
    end

    test "must-refetch" do
      assert [%ControlMessage{control: :must_refetch}] =
               Message.parse(%{"headers" => %{"control" => "must-refetch"}}, "handle", & &1)

      assert [%ControlMessage{control: :must_refetch}] =
               Message.parse(%{headers: %{control: "must-refetch"}}, "handle", & &1)
    end

    test "snapshot-end" do
      assert [%ControlMessage{control: :snapshot_end}] =
               Message.parse(%{"headers" => %{"control" => "snapshot-end"}}, "handle", & &1)

      assert [%ControlMessage{control: :snapshot_end}] =
               Message.parse(%{headers: %{control: "snapshot-end"}}, "handle", & &1)
    end
  end
end
