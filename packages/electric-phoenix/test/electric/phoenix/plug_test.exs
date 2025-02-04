defmodule Electric.Phoenix.PlugTest do
  use ExUnit.Case, async: true
  use Plug.Test

  require Phoenix.ConnTest

  @endpoint Electric.Phoenix.LiveViewTest.Endpoint

  Code.ensure_loaded(Support.User)

  doctest Electric.Phoenix.Plug

  defmodule MyEnv do
    def client!(opts \\ []) do
      Electric.Client.new!(
        base_url: "https://cloud.electric-sql.com",
        authenticator:
          Keyword.get(
            opts,
            :authenticator,
            {Electric.Client.Authenticator.MockAuthenticator, salt: "my-salt"}
          )
      )
    end

    def authenticate(conn, shape, opts \\ [])

    def authenticate(%Plug.Conn{} = conn, %Electric.Client.ShapeDefinition{} = shape, opts) do
      mode = Keyword.get(opts, :mode, :fun)

      %{
        "shape-auth-mode" => to_string(mode),
        "shape-auth-path" => conn.request_path,
        "shape-auth-table" => shape.table
      }
    end
  end

  defmodule MyEnv.TestRouter do
    use Plug.Router

    plug :match
    plug :dispatch

    import Ecto.Query

    Code.ensure_loaded(Support.User)

    forward "/shapes/items",
      to: Electric.Phoenix.Plug,
      shape: Electric.Client.shape!("items"),
      client: MyEnv.client!()

    forward "/shapes/items-columns",
      to: Electric.Phoenix.Plug,
      shape: Electric.Client.shape!("items", columns: ["id", "value"]),
      client: MyEnv.client!()

    forward "/shapes/users-ecto",
      to: Electric.Phoenix.Plug,
      shape: Support.User,
      client: MyEnv.client!()

    forward "/shapes/users-query",
      to: Electric.Phoenix.Plug,
      shape: from(u in Support.User, where: u.visible == true),
      client: MyEnv.client!()

    forward "/shapes/reasons",
      to: Electric.Phoenix.Plug,
      client: MyEnv.client!(),
      assigns: %{shape: Electric.Client.shape!("reasons", where: "valid = true")}

    forward "/shapes/users/:user_id/:age",
      to: Electric.Phoenix.Plug,
      shape:
        Electric.Phoenix.Plug.shape!(
          from(u in Support.User, where: u.visible == true),
          id: :user_id,
          age: [>: :age]
        ),
      client: MyEnv.client!()

    forward "/shapes/keyword/:user_id/:age",
      to: Electric.Phoenix.Plug,
      shape: [
        from(u in Support.User, where: u.visible == true),
        id: :user_id,
        age: [>: :age]
      ],
      client: MyEnv.client!()

    forward "/shapes/atom/:visible",
      to: Electric.Phoenix.Plug,
      shape: [Support.User, :visible],
      client: MyEnv.client!()

    forward "/shapes/authenticator/fun",
      to: Electric.Phoenix.Plug,
      shape: Support.User,
      authenticator: &MyEnv.authenticate/2,
      client: MyEnv.client!()

    forward "/shapes/authenticator/mfa",
      to: Electric.Phoenix.Plug,
      shape: Support.User,
      authenticator: {MyEnv, :authenticate, [mode: :mfa]},
      client: MyEnv.client!()

    get "/shapes/dynamic/:user_id/:age" do
      shape =
        Support.User
        |> where(visible: ^conn.params["visible"], id: ^conn.params["user_id"])
        |> where([u], u.age > ^conn.params["age"])

      Electric.Phoenix.Plug.send_configuration(conn, shape, MyEnv.client!())
    end
  end

  describe "Plug" do
    test "returns a url and query parameters" do
      resp =
        conn(:get, "/things", %{"table" => "things"})
        |> Electric.Phoenix.Plug.call(%{client: MyEnv.client!()})

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "things",
               "headers" => %{"electric-mock-auth" => hash}
             } = Jason.decode!(body)

      assert is_binary(hash)
    end

    test "includes where clauses in returned parameters" do
      resp =
        conn(:get, "/things", %{"table" => "things", "where" => "colour = 'blue'"})
        |> Electric.Phoenix.Plug.call(%{client: MyEnv.client!()})

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "things",
               "where" => "colour = 'blue'",
               "headers" => %{"electric-mock-auth" => hash}
             } = Jason.decode!(body)

      assert is_binary(hash)
    end

    test "allows for preconfiguring the shape" do
      resp =
        conn(:get, "/shapes/items", %{})
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "items",
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)
    end

    test "allows for preconfiguring the shape with columns" do
      resp =
        conn(:get, "/shapes/items-columns", %{})
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "items",
               "columns" => ["id", "value"],
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)
    end

    test "allows for preconfiguring the shape via assigns" do
      resp =
        conn(:get, "/shapes/reasons", %{})
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "reasons",
               "where" => "valid = true",
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)
    end

    test "allows for defining the shape with an ecto struct" do
      resp =
        conn(:get, "/shapes/users-ecto", %{})
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "users",
               "columns" => ["id", "name", "visible", "age"],
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)
    end

    test "allows for defining the shape with an ecto query" do
      resp =
        conn(:get, "/shapes/users-query", %{})
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "users",
               "where" => ~s[("visible" = TRUE)],
               "columns" => ["id", "name", "visible", "age"],
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)
    end

    test "allows for defining a shape using path parameters" do
      resp =
        conn(:get, "/shapes/users/b9d228a6-307e-442f-bee7-730a8b66ab5a/32", %{"visible" => true})
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "users",
               "where" =>
                 ~s[("visible" = TRUE) AND ("id" = 'b9d228a6-307e-442f-bee7-730a8b66ab5a') AND ("age" > 32)],
               "columns" => ["id", "name", "visible", "age"],
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)

      # TODO: tests for where clause gen
    end

    test "raises if parameter will not cast to column type" do
      assert_raise Plug.Conn.WrapperError, fn ->
        conn(:get, "/shapes/users/--;%20delete%20from%20users/32", %{"visible" => true})
        |> MyEnv.TestRouter.call([])
      end
    end

    test "allows for defining a dynamic shape with a keyword list" do
      resp =
        conn(:get, "/shapes/keyword/b9d228a6-307e-442f-bee7-730a8b66ab5a/32", %{"visible" => true})
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "users",
               "columns" => ["id", "name", "visible", "age"],
               "where" =>
                 ~s[("visible" = TRUE) AND ("id" = 'b9d228a6-307e-442f-bee7-730a8b66ab5a') AND ("age" > 32)],
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)
    end

    test "allows for defining a dynamic shape when column and parameter name are the same" do
      resp =
        conn(:get, "/shapes/atom/true", %{})
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "users",
               "columns" => ["id", "name", "visible", "age"],
               "where" => ~s[("visible" = TRUE)],
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)
    end

    test "send_configuration/3" do
      resp =
        conn(:get, "/shapes/dynamic/b9d228a6-307e-442f-bee7-730a8b66ab5a/44", %{
          "visible" => false
        })
        |> MyEnv.TestRouter.call([])

      assert {200, _headers, body} = sent_resp(resp)

      assert %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "users",
               "where" =>
                 ~s[(("visible" = FALSE) AND ("id" = 'b9d228a6-307e-442f-bee7-730a8b66ab5a')) AND ("age" > 44)],
               "columns" => ["id", "name", "visible", "age"],
               "headers" => %{"electric-mock-auth" => _hash}
             } = Jason.decode!(body)
    end

    test "works with Phoenix.Router.forward/3" do
      resp =
        Phoenix.ConnTest.build_conn()
        |> Phoenix.ConnTest.get("/shape/items")

      assert Phoenix.ConnTest.json_response(resp, 200) == %{
               "url" => "http://localhost:3000/v1/shape",
               "table" => "items",
               "where" => "visible = true",
               "headers" => %{}
             }
    end

    test "works with Phoenix.Router.forward/3 and paramter based shapes" do
      resp =
        Phoenix.ConnTest.build_conn()
        |> Phoenix.ConnTest.get("/shape/generic", %{
          "table" => "clothes",
          "where" => "colour = 'red'"
        })

      assert Phoenix.ConnTest.json_response(resp, 200) == %{
               "url" => "http://localhost:3000/v1/shape",
               "table" => "clothes",
               "where" => "colour = 'red'",
               "headers" => %{}
             }
    end

    test "allows for defining a custom authentication fun" do
      resp =
        conn(:get, "/shapes/authenticator/fun", %{})
        |> MyEnv.TestRouter.call([])

      assert Phoenix.ConnTest.json_response(resp, 200) == %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "users",
               "columns" => ["id", "name", "visible", "age"],
               "headers" => %{
                 "electric-mock-auth" =>
                   "0225aed4f0e936943894b874e0e1bb3770189deccadf71980b35acaea066ca9a",
                 "shape-auth-mode" => "fun",
                 "shape-auth-path" => "/shapes/authenticator/fun",
                 "shape-auth-table" => "users"
               }
             }
    end

    test "allows for defining a custom authentication mfa" do
      resp =
        conn(:get, "/shapes/authenticator/mfa", %{})
        |> MyEnv.TestRouter.call([])

      assert Phoenix.ConnTest.json_response(resp, 200) == %{
               "url" => "https://cloud.electric-sql.com/v1/shape",
               "table" => "users",
               "columns" => ["id", "name", "visible", "age"],
               "headers" => %{
                 "electric-mock-auth" =>
                   "0225aed4f0e936943894b874e0e1bb3770189deccadf71980b35acaea066ca9a",
                 "shape-auth-mode" => "mfa",
                 "shape-auth-path" => "/shapes/authenticator/mfa",
                 "shape-auth-table" => "users"
               }
             }
    end
  end
end
