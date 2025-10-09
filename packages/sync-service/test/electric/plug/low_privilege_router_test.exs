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
    setup %{db_conn: db_conn, escaped_db_name: db_name} do
      Postgrex.query!(db_conn, "GRANT CREATE ON DATABASE \"#{db_name}\" TO unprivileged", [])
      %{connection_opt_overrides: [port: 54321, username: "unprivileged"]}
    end

    setup [:with_complete_stack, :with_router]

    @tag with_sql: ["INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"]
    test "GET fails to create initial snapshot when Electric does not own the user table", ctx do
      assert {503,
              %{"message" => "Unable to create initial snapshot: must be owner of table items"}} ==
               get_shape(ctx)
    end
  end

  describe "/v1/shapes with manual publication management" do
    setup do
      %{
        connection_opt_overrides: [port: 54321, username: "unprivileged"],
        manual_table_publishing?: true
      }
    end

    setup [:with_publication, :with_complete_stack, :with_router]

    test "GET fails to create initial snapshot when Electric cannot read from the table", ctx do
      assert {503,
              %{
                "message" =>
                  "Database table \"public.items\" is missing from the publication \"#{ctx.publication_name}\" and the ELECTRIC_MANUAL_TABLE_PUBLISHING setting prevents Electric from adding it"
              }} == get_shape(ctx)

      Postgrex.query!(ctx.pool, "ALTER PUBLICATION \"#{ctx.publication_name}\" ADD TABLE items")

      assert {503,
              %{
                "message" =>
                  "Database table \"public.items\" does not have its replica identity set to FULL"
              }} ==
               get_shape(ctx)

      Postgrex.query!(ctx.pool, "ALTER TABLE items REPLICA IDENTITY FULL")

      assert {503,
              %{
                "message" =>
                  "Unable to create initial snapshot: permission denied for table items"
              }} == get_shape(ctx)
    end
  end

  defp with_router(ctx) do
    :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, 1000)
    %{opts: Router.init(build_router_opts(ctx))}
  end

  defp get_shape(ctx) do
    conn =
      conn("GET", "/v1/shape?table=items&offset=-1")
      |> Router.call(ctx.opts)

    assert %Plug.Conn{status: status, resp_body: json_str} = conn
    {status, Jason.decode!(json_str)}
  end
end
