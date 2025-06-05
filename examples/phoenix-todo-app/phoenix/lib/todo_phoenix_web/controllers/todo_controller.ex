defmodule TodoPhoenixWeb.TodoController do
  use TodoPhoenixWeb, :controller
  alias TodoPhoenix.Todos
  alias TodoPhoenix.Todos.Todo

  action_fallback TodoPhoenixWeb.FallbackController

  @doc """
  Creates a new todo.
  Expects: {id: uuid, title: string, completed?: boolean}
  Returns: 200 "ok" (matching original Node.js API)
  """
  def create(conn, todo_params) do
    with {:ok, %Todo{}} <- Todos.create_todo(todo_params) do
      send_resp(conn, :ok, "ok")
    end
  end

  @doc """
  Updates an existing todo.
  Expects: {title?: string, completed?: boolean}
  Returns: 200 "ok"
  """
  def update(conn, %{"id" => id} = params) do
    update_params = Map.drop(params, ["id"])

    try do
      todo = Todos.get_todo!(id)
      with {:ok, %Todo{}} <- Todos.update_todo(todo, update_params) do
        send_resp(conn, :ok, "ok")
      end
    rescue
      Ecto.NoResultsError ->
        conn
        |> put_status(:not_found)
        |> put_view(json: TodoPhoenixWeb.ErrorJSON)
        |> render(:"404")
    end
  end

  @doc """
  Deletes a todo.
  Returns: 200 "ok"
  """
  def delete(conn, %{"id" => id}) do
    try do
      todo = Todos.get_todo!(id)
      with {:ok, %Todo{}} <- Todos.delete_todo(todo) do
        send_resp(conn, :ok, "ok")
      end
    rescue
      Ecto.NoResultsError ->
        conn
        |> put_status(:not_found)
        |> put_view(json: TodoPhoenixWeb.ErrorJSON)
        |> render(:"404")
    end
  end
end
