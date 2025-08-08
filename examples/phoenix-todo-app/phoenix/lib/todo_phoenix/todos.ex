defmodule TodoPhoenix.Todos do
  @moduledoc """
  The Todos context - handles all todo-related business logic.
  """

  import Ecto.Query, warn: false
  alias TodoPhoenix.Repo
  alias TodoPhoenix.Todos.Todo

  @doc """
  Returns the list of todos ordered by creation time.
  """
  def list_todos do
    from(t in Todo, order_by: [asc: t.inserted_at])
    |> Repo.all()
  end

  @doc """
  Gets a single todo by ID.
  Raises `Ecto.NoResultsError` if the Todo does not exist.
  """
  def get_todo!(id) do
    Repo.get!(Todo, id)
  end

  @doc """
  Creates a todo with the given attributes.
  """
  def create_todo(attrs \\ %{}) do
    %Todo{}
    |> Todo.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a todo with the given attributes.
  """
  def update_todo(%Todo{} = todo, attrs) do
    todo
    |> Todo.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a todo.
  """
  def delete_todo(%Todo{} = todo) do
    Repo.delete(todo)
  end

  @doc """
  Returns count of todos for monitoring/stats.
  """
  def count_todos do
    Repo.aggregate(Todo, :count)
  end

  @doc """
  Query for completed todos - useful for shapes.
  """
  def completed_todos_query do
    from(t in Todo, where: t.completed == true, order_by: [asc: t.inserted_at])
  end

  @doc """
  Query for active todos - useful for shapes.
  """
  def active_todos_query do
    from(t in Todo, where: t.completed == false, order_by: [asc: t.inserted_at])
  end
end
