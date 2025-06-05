defmodule TodoPhoenix.Todos.TodoTest do
  use TodoPhoenix.DataCase, async: true
  alias TodoPhoenix.Todos.Todo

  describe "changeset/2" do
    test "valid changeset with required fields" do
      attrs = %{id: Ecto.UUID.generate(), title: "Test todo"}
      changeset = Todo.changeset(%Todo{}, attrs)
      assert changeset.valid?
    end

    test "invalid changeset without title" do
      attrs = %{id: Ecto.UUID.generate()}
      changeset = Todo.changeset(%Todo{}, attrs)
      refute changeset.valid?
      assert "can't be blank" in errors_on(changeset).title
    end

    test "validates title length" do
      long_title = String.duplicate("a", 501)
      attrs = %{id: Ecto.UUID.generate(), title: long_title}
      changeset = Todo.changeset(%Todo{}, attrs)
      refute changeset.valid?
      assert "should be at most 500 character(s)" in errors_on(changeset).title
    end

    test "validates minimum title length" do
      attrs = %{id: Ecto.UUID.generate(), title: ""}
      changeset = Todo.changeset(%Todo{}, attrs)
      refute changeset.valid?
      assert "can't be blank" in errors_on(changeset).title
    end

    test "validates UUID format" do
      attrs = %{id: "invalid-uuid", title: "Test"}
      changeset = Todo.changeset(%Todo{}, attrs)
      refute changeset.valid?
      assert "must be a valid UUID" in errors_on(changeset).id
    end

    test "generates UUID if not provided" do
      attrs = %{title: "Test"}
      changeset = Todo.changeset(%Todo{}, attrs)
      assert changeset.valid?
      assert get_field(changeset, :id) != nil
    end

    test "keeps provided UUID if valid" do
      uuid = Ecto.UUID.generate()
      attrs = %{id: uuid, title: "Test"}
      changeset = Todo.changeset(%Todo{}, attrs)
      assert changeset.valid?
      assert get_field(changeset, :id) == uuid
    end

    test "defaults completed to false" do
      attrs = %{title: "Test"}
      changeset = Todo.changeset(%Todo{}, attrs)
      assert get_field(changeset, :completed) == false
    end

    test "allows setting completed to true" do
      attrs = %{title: "Test", completed: true}
      changeset = Todo.changeset(%Todo{}, attrs)
      assert changeset.valid?
      assert get_field(changeset, :completed) == true
    end
  end
end
