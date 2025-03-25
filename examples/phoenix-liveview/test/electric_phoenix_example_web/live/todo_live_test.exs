defmodule Electric.PhoenixExampleWeb.TodoLiveTest do
  use Electric.PhoenixExampleWeb.ConnCase

  import Phoenix.LiveViewTest
  import Electric.PhoenixExample.TodosFixtures

  # FIXME: these tests fail because the liveview relies on sync_stream
  #        and in tests nothing appears on the replication stream
  @moduletag skip: true

  @create_attrs %{text: "Fix tests", completed: true}
  # @update_attrs %{text: "some updated text", completed: false}
  # @invalid_attrs %{text: nil, completed: false}

  defp create_todo(_) do
    todo = todo_fixture()
    %{todo: todo}
  end

  describe "Index" do
    setup [:create_todo]

    test "lists all todos", %{conn: conn, todo: todo} do
      {:ok, _index_live, html} = live(conn, ~p"/")

      assert html =~ "Listing Todos"
      assert html =~ todo.text
    end

    test "saves new todo", %{conn: conn} do
      {:ok, index_live, _html} = live(conn, ~p"/")

      form = form(index_live, "#todo-form", todo: @create_attrs) |> dbg

      assert render_submit(form) =~ "Fix tests"
    end

    test "deletes todo in listing", %{conn: conn, todo: todo} do
      {:ok, index_live, _html} = live(conn, ~p"/")

      assert index_live |> element("#todos-#{todo.id} a", "Delete") |> render_click()
      refute has_element?(index_live, "#todos-#{todo.id}")
    end
  end
end
