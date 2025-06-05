defmodule TodoPhoenix.TodosTest do
  use TodoPhoenix.DataCase, async: true
  alias TodoPhoenix.Todos
  alias TodoPhoenix.Todos.Todo

  describe "create_todo/1" do
    test "with valid data creates a todo" do
      attrs = %{id: Ecto.UUID.generate(), title: "Test todo"}
      assert {:ok, todo} = Todos.create_todo(attrs)
      assert todo.title == "Test todo"
      assert todo.completed == false
      assert todo.id != nil
    end

    test "with invalid data returns error changeset" do
      assert {:error, %Ecto.Changeset{}} = Todos.create_todo(%{})
    end

    test "generates UUID if not provided" do
      attrs = %{title: "Test todo without ID"}
      assert {:ok, todo} = Todos.create_todo(attrs)
      assert todo.id != nil
    end
  end

  describe "get_todo!/1" do
    test "returns the todo with given id" do
      todo = todo_fixture()
      assert Todos.get_todo!(todo.id) == todo
    end

    test "raises when todo doesn't exist" do
      assert_raise Ecto.NoResultsError, fn ->
        Todos.get_todo!(Ecto.UUID.generate())
      end
    end
  end

  describe "update_todo/2" do
    test "with valid data updates the todo" do
      todo = todo_fixture()
      update_attrs = %{title: "Updated title", completed: true}

      assert {:ok, updated_todo} = Todos.update_todo(todo, update_attrs)
      assert updated_todo.title == "Updated title"
      assert updated_todo.completed == true
      assert updated_todo.id == todo.id
    end

    test "with invalid data returns error changeset" do
      todo = todo_fixture()
      assert {:error, %Ecto.Changeset{}} = Todos.update_todo(todo, %{title: nil})
      assert todo == Todos.get_todo!(todo.id)
    end

    test "can toggle completion status" do
      todo = todo_fixture(%{completed: false})
      assert {:ok, updated_todo} = Todos.update_todo(todo, %{completed: true})
      assert updated_todo.completed == true
    end
  end

  describe "delete_todo/1" do
    test "deletes the todo" do
      todo = todo_fixture()
      assert {:ok, %Todo{}} = Todos.delete_todo(todo)
      assert_raise Ecto.NoResultsError, fn -> Todos.get_todo!(todo.id) end
    end
  end

  describe "list_todos/0" do
    test "returns all todos ordered by insertion" do
      todo1 = todo_fixture(%{title: "First"})
      todo2 = todo_fixture(%{title: "Second"})

      todos = Todos.list_todos()
      assert length(todos) == 2
      assert hd(todos).id == todo1.id
      assert List.last(todos).id == todo2.id
    end

    test "returns empty list when no todos exist" do
      assert Todos.list_todos() == []
    end
  end

  describe "count_todos/0" do
    test "returns the correct count" do
      assert Todos.count_todos() == 0

      todo_fixture()
      assert Todos.count_todos() == 1

      todo_fixture()
      assert Todos.count_todos() == 2
    end
  end

  describe "query functions" do
    test "completed_todos_query returns only completed todos" do
      completed_todo = completed_todo_fixture()
      _active_todo = todo_fixture(%{completed: false})

      completed_todos = Todos.completed_todos_query() |> Repo.all()
      assert length(completed_todos) == 1
      assert hd(completed_todos).id == completed_todo.id
    end

    test "active_todos_query returns only active todos" do
      _completed_todo = completed_todo_fixture()
      active_todo = todo_fixture(%{completed: false})

      active_todos = Todos.active_todos_query() |> Repo.all()
      assert length(active_todos) == 1
      assert hd(active_todos).id == active_todo.id
    end
  end
end
