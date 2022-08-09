defmodule Electric.Replication.ToVaxineTest do
  use ExUnit.Case

  alias Electric.Replication.{Changes, Row, ToVaxine}
  alias Electric.VaxRepo
  alias Electric.Postgres.SchemaRegistry

  @id Ecto.UUID.generate()
  @row Row.new("fake", "to_vaxine_test", %{"id" => @id}, ["id"])

  def new_record_change(columns \\ %{"content" => "a"}) do
    %Changes.NewRecord{
      record: Map.put(columns, "id", @id),
      relation: {"fake", "to_vaxine_test"}
    }
  end

  def updated_record_change(old_columns, new_columns) do
    %Changes.UpdatedRecord{
      old_record: Map.put(old_columns, "id", @id),
      record: Map.put(new_columns, "id", @id),
      relation: {"fake", "to_vaxine_test"}
    }
  end

  def deleted_record_change(old_columns) do
    %Changes.DeletedRecord{
      old_record: Map.put(old_columns, "id", @id),
      relation: {"fake", "to_vaxine_test"}
    }
  end

  setup_all _ do
    Electric.Test.SchemaRegistryHelper.initialize_registry(
      "fake_publication",
      {"fake", "to_vaxine_test"},
      id: :uuid,
      content: :text,
      content_b: :text
    )

    on_exit(fn -> SchemaRegistry.clear_replicated_tables("fake_publication") end)

    :ok
  end

  describe "ToVaxine propagates changes to vaxine" do
    test "for NewRecord" do
      assert :ok =
               %{"content" => "a"}
               |> new_record_change()
               |> ToVaxine.handle_change()

      assert %{row: %{"content" => "a"}, deleted?: false} = VaxRepo.reload(@row)
    end

    test "for UpdatedRecord" do
      assert :ok =
               %{"content" => "a"}
               |> updated_record_change(%{"content" => "b"})
               |> ToVaxine.handle_change()

      assert %{row: %{"content" => "b"}} = VaxRepo.reload(@row)
    end

    test "for DeletedRecord" do
      assert :ok =
               %{"content" => "a"}
               |> deleted_record_change()
               |> ToVaxine.handle_change()

      assert %{deleted?: true} = VaxRepo.reload(@row)
    after
      # undoing delete to have clean state
      %{"content" => "a"}
      |> new_record_change()
      |> ToVaxine.handle_change()
    end
  end

  describe "Conflict situations" do
    test "rows are merged for new record" do
      concurrent_transactions(
        fn ->
          %{"content" => "a"}
          |> new_record_change()
          |> ToVaxine.handle_change()
        end,
        fn ->
          %{"content_b" => "b"}
          |> new_record_change()
          |> ToVaxine.handle_change()
        end
      )

      assert %{row: %{"content" => "a", "content_b" => "b"}, deleted?: false} =
               VaxRepo.reload(@row)
    end

    test "rows are merged for updated record" do
      concurrent_transactions(
        fn ->
          %{"content" => "a"}
          |> updated_record_change(%{"content" => "b"})
          |> ToVaxine.handle_change()
        end,
        fn ->
          %{"content_b" => "b"}
          |> updated_record_change(%{"content_b" => "c"})
          |> ToVaxine.handle_change()
        end
      )

      assert %{row: %{"content" => "b", "content_b" => "c"}, deleted?: false} =
               VaxRepo.reload(@row)
    end

    test "update > delete" do
      concurrent_transactions(
        fn ->
          %{"content" => "a"}
          |> updated_record_change(%{"content" => "b"})
          |> ToVaxine.handle_change()
        end,
        fn ->
          %{"content" => "a"}
          |> deleted_record_change()
          |> ToVaxine.handle_change()
        end
      )

      assert %{row: %{"content" => "b"}, deleted?: false} = VaxRepo.reload(@row)
    end

    test "insert > delete" do
      concurrent_transactions(
        fn ->
          %{"content" => "a"}
          |> new_record_change()
          |> ToVaxine.handle_change()
        end,
        fn ->
          %{"content" => "a"}
          |> deleted_record_change()
          |> ToVaxine.handle_change()
        end
      )

      assert %{row: %{"content" => "a"}, deleted?: false} = VaxRepo.reload(@row)
    end
  end

  # transaction 2 starts
  # transaction 1 starts
  # transaction 1 executes its code
  # transaction 2 executes its code
  # transaction 1 commits
  # transaction 2 commits
  def concurrent_transactions(operation_set_1, operation_set_2) do
    parent = self()

    p1 =
      spawn(fn ->
        assert_receive {:start, p2}

        VaxRepo.transaction(fn ->
          operation_set_1.()
          send(p2, :continue)
          assert_receive :commit
        end)

        send(parent, :commited_1)
        send(p2, :commit)
      end)

    _p2 =
      spawn(fn ->
        VaxRepo.transaction(fn ->
          send(p1, {:start, self()})
          assert_receive :continue
          operation_set_2.()
          send(p1, :commit)
          assert_receive :commit
        end)

        send(parent, :commited_2)
      end)

    assert_receive :commited_1
    assert_receive :commited_2
  end
end
