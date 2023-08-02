defmodule Electric.Replication.Changes.OwnershipTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.{
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    Ownership
  }

  @user_id_col Ownership.id_column_name()

  defp owned_change(DeletedRecord, user_id) do
    change(DeletedRecord, old_record: owned_record(user_id))
  end

  defp owned_change(type, user_id) when type in [NewRecord, UpdatedRecord] do
    change(type, record: owned_record(user_id))
  end

  defp change(type, attrs) do
    struct(type, [{:relation, {"public", "table"}} | attrs])
  end

  defp owned_record(user_id) do
    %{@user_id_col => user_id}
  end

  defp change_stream(user_ids) do
    [NewRecord, UpdatedRecord, DeletedRecord]
    |> Stream.cycle()
    |> Stream.zip(Stream.cycle(user_ids))
    |> Stream.map(fn {type, user_id} -> owned_change(type, user_id) end)
  end

  defp change_list(user_ids, length) do
    change_stream(user_ids)
    |> Enum.take(length)
  end

  describe "belongs_to_user?/2" do
    test "accepts a transaction that belongs to the current user" do
      user_id = Electric.Utils.uuid4()

      changes = change_list([user_id], 5)

      assert changes == Enum.filter(changes, &Ownership.change_belongs_to_user?(&1, user_id))
    end

    test "rejects a transaction that contains any changes not owned by user" do
      user_id1 = Electric.Utils.uuid4()
      user_id2 = Electric.Utils.uuid4()

      changes = change_list([user_id1, user_id2], 5)

      assert [_, _, _] = Enum.filter(changes, &Ownership.change_belongs_to_user?(&1, user_id1))
    end

    test "accepts any rows where the electric_user_id is null or empty" do
      user_id = Electric.Utils.uuid4()

      for empty <- [nil, ""] do
        change = %NewRecord{
          relation: {"public", "global_table"},
          record: %{"value" => "something", "electric_user_id" => empty}
        }

        assert Ownership.change_belongs_to_user?(change, user_id)
      end
    end

    test "accepts any tables without a electric_user_id column" do
      user_id = Electric.Utils.uuid4()

      change = %NewRecord{relation: {"public", "global_table"}, record: %{"value" => "something"}}

      assert Ownership.change_belongs_to_user?(change, user_id)
    end
  end
end
