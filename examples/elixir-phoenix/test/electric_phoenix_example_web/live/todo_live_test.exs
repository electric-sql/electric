defmodule Electric.PhoenixExampleWeb.TodoLiveTest do
  use Electric.PhoenixExampleWeb.ConnCase

  import Phoenix.LiveViewTest
  import Electric.PhoenixExample.TodosFixtures

  @create_attrs %{text: "some text", completed: true}
  @update_attrs %{text: "some updated text", completed: false}
  @invalid_attrs %{text: nil, completed: false}

  defp create_todo(_) do
    todo = todo_fixture()
    %{todo: todo}
  end

  describe "Index" do
    setup [:create_todo]

    test "lists all todos", %{conn: conn, todo: todo} do
      {:ok, _index_live, html} = live(conn, ~p"/todos")

      assert html =~ "Listing Todos"
      assert html =~ todo.text
    end

    test "saves new todo", %{conn: conn} do
      {:ok, index_live, _html} = live(conn, ~p"/todos")

      assert index_live |> element("a", "New Todo") |> render_click() =~
               "New Todo"

      assert_patch(index_live, ~p"/todos/new")

      assert index_live
             |> form("#todo-form", todo: @invalid_attrs)
             |> render_change() =~ "can&#39;t be blank"

      assert index_live
             |> form("#todo-form", todo: @create_attrs)
             |> render_submit()

      assert_patch(index_live, ~p"/todos")

      html = render(index_live)
      assert html =~ "Todo created successfully"
      assert html =~ "some text"
    end

    test "updates todo in listing", %{conn: conn, todo: todo} do
      {:ok, index_live, _html} = live(conn, ~p"/todos")

      assert index_live |> element("#todos-#{todo.id} a", "Edit") |> render_click() =~
               "Edit Todo"

      assert_patch(index_live, ~p"/todos/#{todo}/edit")

      assert index_live
             |> form("#todo-form", todo: @invalid_attrs)
             |> render_change() =~ "can&#39;t be blank"

      assert index_live
             |> form("#todo-form", todo: @update_attrs)
             |> render_submit()

      assert_patch(index_live, ~p"/todos")

      html = render(index_live)
      assert html =~ "Todo updated successfully"
      assert html =~ "some updated text"
    end

    test "deletes todo in listing", %{conn: conn, todo: todo} do
      {:ok, index_live, _html} = live(conn, ~p"/todos")

      assert index_live |> element("#todos-#{todo.id} a", "Delete") |> render_click()
      refute has_element?(index_live, "#todos-#{todo.id}")
    end
  end

  describe "Show" do
    setup [:create_todo]

    test "displays todo", %{conn: conn, todo: todo} do
      {:ok, _show_live, html} = live(conn, ~p"/todos/#{todo}")

      assert html =~ "Show Todo"
      assert html =~ todo.text
    end

    test "updates todo within modal", %{conn: conn, todo: todo} do
      {:ok, show_live, _html} = live(conn, ~p"/todos/#{todo}")

      assert show_live |> element("a", "Edit") |> render_click() =~
               "Edit Todo"

      assert_patch(show_live, ~p"/todos/#{todo}/show/edit")

      assert show_live
             |> form("#todo-form", todo: @invalid_attrs)
             |> render_change() =~ "can&#39;t be blank"

      assert show_live
             |> form("#todo-form", todo: @update_attrs)
             |> render_submit()

      assert_patch(show_live, ~p"/todos/#{todo}")

      html = render(show_live)
      assert html =~ "Todo updated successfully"
      assert html =~ "some updated text"
    end
  end
end
