defmodule Electric.PhoenixEmbedded.TodosTest do
  use Electric.PhoenixEmbedded.DataCase

  alias Electric.PhoenixEmbedded.Todos

  describe "todos" do
    alias Electric.PhoenixEmbedded.Todos.Todo

    import Electric.PhoenixEmbedded.TodosFixtures

    @invalid_attrs %{id: nil, title: nil, completed: nil}

    test "list_todos/0 returns all todos" do
      todo = todo_fixture()
      assert Todos.list_todos() == [todo]
    end

    test "get_todo!/1 returns the todo with given id" do
      todo = todo_fixture()
      assert Todos.get_todo!(todo.id) == todo
    end

    test "create_todo/1 with valid data creates a todo" do
      valid_attrs = %{id: "7488a646-e31f-11e4-aace-600308960662", title: "some title", completed: true}

      assert {:ok, %Todo{} = todo} = Todos.create_todo(valid_attrs)
      assert todo.id == "7488a646-e31f-11e4-aace-600308960662"
      assert todo.title == "some title"
      assert todo.completed == true
    end

    test "create_todo/1 with invalid data returns error changeset" do
      assert {:error, %Ecto.Changeset{}} = Todos.create_todo(@invalid_attrs)
    end

    test "update_todo/2 with valid data updates the todo" do
      todo = todo_fixture()
      update_attrs = %{id: "7488a646-e31f-11e4-aace-600308960668", title: "some updated title", completed: false}

      assert {:ok, %Todo{} = todo} = Todos.update_todo(todo, update_attrs)
      assert todo.id == "7488a646-e31f-11e4-aace-600308960668"
      assert todo.title == "some updated title"
      assert todo.completed == false
    end

    test "update_todo/2 with invalid data returns error changeset" do
      todo = todo_fixture()
      assert {:error, %Ecto.Changeset{}} = Todos.update_todo(todo, @invalid_attrs)
      assert todo == Todos.get_todo!(todo.id)
    end

    test "delete_todo/1 deletes the todo" do
      todo = todo_fixture()
      assert {:ok, %Todo{}} = Todos.delete_todo(todo)
      assert_raise Ecto.NoResultsError, fn -> Todos.get_todo!(todo.id) end
    end

    test "change_todo/1 returns a todo changeset" do
      todo = todo_fixture()
      assert %Ecto.Changeset{} = Todos.change_todo(todo)
    end
  end
end
