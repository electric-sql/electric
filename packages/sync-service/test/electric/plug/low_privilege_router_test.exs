defmodule Electric.Plug.LowPrivilegeRouterTest do
  @moduledoc """
  Integration router tests that set up entire stack with unique DB.

  These tests are using an unprivileged DB role to verify correct error handling when the role
  has insufficient permissions.
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Plug.Test

  alias Electric.Plug.Router

  @moduletag :tmp_dir

  setup [:with_unique_db, :with_basic_tables, :with_sql_execute]

  describe "/v1/shapes" do
    setup %{db_conn: conn, escaped_db_name: db_name} do
      Postgrex.query!(conn, "GRANT CREATE ON DATABASE \"#{db_name}\" TO unprivileged", [])
      %{connection_opt_overrides: [port: 54321, username: "unprivileged"]}
    end

    setup [:with_complete_stack, :with_router]

    @tag with_sql: ["INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"]
    test "GET fails to create initial snapshot when Electric does not own the user table ", %{
      opts: opts
    } do
      conn =
        conn("GET", "/v1/shape?table=items&offset=-1")
        |> Router.call(opts)

      assert %Plug.Conn{status: 503, resp_body: json_str} = conn

      assert %{"message" => "Unable to create initial snapshot: must be owner of table items"} ==
               Jason.decode!(json_str)
    end
  end

  defp with_router(ctx) do
    :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, 1000)
    %{opts: Router.init(build_router_opts(ctx))}
  end
end
