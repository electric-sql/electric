defmodule TodoPhoenixWeb.TodoControllerTest do
  use TodoPhoenixWeb.ConnCase, async: true

  describe "create/2" do
    test "creates todo with valid data", %{conn: conn} do
      todo_params = %{
        id: Ecto.UUID.generate(),
        title: "Test todo"
      }

      conn = post(conn, ~p"/api/todos", todo_params)
      assert response(conn, 200) == "ok"
    end

    test "creates todo without id (generates UUID)", %{conn: conn} do
      todo_params = %{title: "Test todo without ID"}

      conn = post(conn, ~p"/api/todos", todo_params)
      assert response(conn, 200) == "ok"
    end

    test "returns 422 with invalid data", %{conn: conn} do
      todo_params = %{}

      conn = post(conn, ~p"/api/todos", todo_params)
      assert response(conn, 422)
      assert json_response(conn, 422)["errors"] != nil
    end

    test "returns 422 with invalid UUID", %{conn: conn} do
      todo_params = %{
        id: "invalid-uuid",
        title: "Test todo"
      }

      conn = post(conn, ~p"/api/todos", todo_params)
      assert response(conn, 422)
      response_data = json_response(conn, 422)
      assert response_data["errors"]["id"] != nil
    end

    test "returns 422 with empty title", %{conn: conn} do
      todo_params = %{
        id: Ecto.UUID.generate(),
        title: ""
      }

      conn = post(conn, ~p"/api/todos", todo_params)
      assert response(conn, 422)
      response_data = json_response(conn, 422)
      assert response_data["errors"]["title"] != nil
    end
  end

  describe "update/2" do
    test "updates todo with valid data", %{conn: conn} do
      todo = todo_fixture()
      update_params = %{title: "Updated title", completed: true}

      conn = put(conn, ~p"/api/todos/#{todo.id}", update_params)
      assert response(conn, 200) == "ok"
    end

    test "toggles completion status", %{conn: conn} do
      todo = todo_fixture(%{completed: false})
      update_params = %{completed: true}

      conn = put(conn, ~p"/api/todos/#{todo.id}", update_params)
      assert response(conn, 200) == "ok"
    end

    test "updates only title", %{conn: conn} do
      todo = todo_fixture()
      update_params = %{title: "New title only"}

      conn = put(conn, ~p"/api/todos/#{todo.id}", update_params)
      assert response(conn, 200) == "ok"
    end

    test "returns 404 for non-existent todo", %{conn: conn} do
      non_existent_id = Ecto.UUID.generate()
      update_params = %{title: "Updated"}

      conn = put(conn, ~p"/api/todos/#{non_existent_id}", update_params)
      assert response(conn, 404)
      assert json_response(conn, 404)["errors"]["detail"] == "Not Found"
    end

    test "returns 422 with invalid data", %{conn: conn} do
      todo = todo_fixture()
      update_params = %{title: nil}

      conn = put(conn, ~p"/api/todos/#{todo.id}", update_params)
      assert response(conn, 422)
      assert json_response(conn, 422)["errors"] != nil
    end

    test "returns 400 with malformed UUID", %{conn: conn} do
      malformed_id = "not-a-uuid"
      update_params = %{title: "Updated"}

      assert_error_sent 400, fn ->
        put(conn, ~p"/api/todos/#{malformed_id}", update_params)
      end
    end
  end

  describe "delete/2" do
    test "deletes existing todo", %{conn: conn} do
      todo = todo_fixture()

      conn = delete(conn, ~p"/api/todos/#{todo.id}")
      assert response(conn, 200) == "ok"
    end

    test "returns 404 for non-existent todo", %{conn: conn} do
      non_existent_id = Ecto.UUID.generate()

      conn = delete(conn, ~p"/api/todos/#{non_existent_id}")
      assert response(conn, 404)
      assert json_response(conn, 404)["errors"]["detail"] == "Not Found"
    end

    test "returns 400 with malformed UUID", %{conn: conn} do
      malformed_id = "not-a-uuid"

      assert_error_sent 400, fn ->
        delete(conn, ~p"/api/todos/#{malformed_id}")
      end
    end
  end
end
