defmodule TodoPhoenix.Fixtures do
  @moduledoc """
  Test data fixtures for todos.
  """

  alias TodoPhoenix.Todos

  def todo_fixture(attrs \\ %{}) do
    {:ok, todo} =
      attrs
      |> Enum.into(%{
        id: Ecto.UUID.generate(),
        title: "Test Todo #{:rand.uniform(1000)}",
        completed: false
      })
      |> Todos.create_todo()

    todo
  end

  def completed_todo_fixture(attrs \\ %{}) do
    todo_fixture(Map.put(attrs, :completed, true))
  end
end
