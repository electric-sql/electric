defmodule Electric.PhoenixEmbedded.TodosFixtures do
  @moduledoc """
  This module defines test helpers for creating
  entities via the `Electric.PhoenixEmbedded.Todos` context.
  """

  @doc """
  Generate a todo.
  """
  def todo_fixture(attrs \\ %{}) do
    {:ok, todo} =
      attrs
      |> Enum.into(%{
        completed: true,
        id: "7488a646-e31f-11e4-aace-600308960662",
        title: "some title"
      })
      |> Electric.PhoenixEmbedded.Todos.create_todo()

    todo
  end
end
