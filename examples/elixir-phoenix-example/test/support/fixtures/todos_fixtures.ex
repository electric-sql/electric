defmodule Electric.PhoenixExample.TodosFixtures do
  @moduledoc """
  This module defines test helpers for creating
  entities via the `Electric.PhoenixExample.Todos` context.
  """

  @doc """
  Generate a todo.
  """
  def todo_fixture(attrs \\ %{}) do
    {:ok, todo} =
      attrs
      |> Enum.into(%{
        completed: true,
        text: "some text"
      })
      |> Electric.PhoenixExample.Todos.create_todo()

    todo
  end
end
