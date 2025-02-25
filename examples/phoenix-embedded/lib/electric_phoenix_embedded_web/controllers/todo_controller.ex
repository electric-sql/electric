defmodule Electric.PhoenixEmbeddedWeb.TodoController do
  use Electric.PhoenixEmbeddedWeb, :controller

  alias Electric.PhoenixEmbedded.Todos
  alias Electric.PhoenixEmbedded.Todos.Todo

  action_fallback Electric.PhoenixEmbeddedWeb.FallbackController

  def index(conn, _params) do
    todos = Todos.list_todos()
    render(conn, :index, todos: todos)
  end

  def create(conn, %{"todo" => todo_params}) do
    with {:ok, %Todo{} = todo} <- Todos.create_todo(todo_params) do
      conn
      |> put_status(:created)
      |> put_resp_header("location", ~p"/api/todos/#{todo}")
      |> put_resp_content_type("application/json")
      |> render(:show, todo: todo)
    end
  end

  def show(conn, %{"id" => id}) do
    todo = Todos.get_todo!(id)

    conn
    |> put_resp_content_type("application/json")
    |> render(:show, todo: todo)
  end

  def update(conn, %{"id" => id, "todo" => todo_params}) do
    todo = Todos.get_todo!(id)

    with {:ok, %Todo{} = todo} <- Todos.update_todo(todo, todo_params) do
      conn
      |> put_resp_content_type("application/json")
      |> render(:show, todo: todo)
    end
  end

  def delete(conn, %{"id" => id}) do
    todo = Todos.get_todo!(id)

    with {:ok, %Todo{}} <- Todos.delete_todo(todo) do
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(:no_content, "")
    end
  end
end
