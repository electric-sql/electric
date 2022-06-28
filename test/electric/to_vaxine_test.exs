defmodule Electric.Replication.ToVaxineTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.{Changes, Row, ToVaxine}
  alias Electric.VaxRepo

  @id Ecto.UUID.generate()
  @row Row.new("public", "entries", %{"id" => @id})

  @new_record_change %Changes.NewRecord{
    record: %{"content" => "a", "id" => @id},
    relation: {"public", "entries"}
  }

  @updated_record_change %Changes.UpdatedRecord{
    old_record: %{"content" => "a", "id" => @id},
    record: %{"content" => "b", "id" => @id},
    relation: {"public", "entries"}
  }

  @deleted_record_change %Changes.DeletedRecord{
    old_record: %{"content" => "a", "id" => @id},
    relation: {"public", "entries"}
  }

  describe "ToVaxine propagates changes to vaxine" do
    test "for NewRecord" do
      assert :ok = ToVaxine.handle_change(@new_record_change)
      assert %{deleted?: false} = VaxRepo.reload(@row)
    end

    test "for UpdatedRecord" do
      assert :ok = ToVaxine.handle_change(@updated_record_change)
      assert %{row: %{"content" => "b"}} = VaxRepo.reload(@row)
    end

    test "for DeletedRecord" do
      assert :ok = ToVaxine.handle_change(@deleted_record_change)
      assert %{deleted?: true} = VaxRepo.reload(@row)
    end
  end
end
