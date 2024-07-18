defmodule Electric.Plug.RouterTest do
  @moduledoc """
  Integration router tests that set up entire stack with unique DB.

  Unit tests should be preferred wherever possible because they will run faster.
  """
  use ExUnit.Case

  alias Electric.Replication.LogOffset
  alias Support.DbStructureSetup
  alias Electric.Plug.Router
  alias Support.DbSetup
  import Support.ComponentSetup
  import Plug.Test

  @moduletag :tmp_dir
  @moduletag :capture_log

  @first_offset to_string(LogOffset.first())

  describe "/v1/shapes" do
    setup {DbSetup, :with_unique_db}
    setup {DbStructureSetup, :with_basic_tables}
    setup {DbStructureSetup, :with_sql_execute}

    setup(do: %{publication_name: "electric_test_pub"})

    setup :with_complete_stack

    setup(ctx, do: %{opts: Router.init(build_router_opts(ctx))})

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "returns a snapshot of initial data", %{opts: opts} do
      conn =
        conn("GET", "/v1/shape/items?offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn

      assert [
               %{
                 "headers" => %{"action" => "insert"},
                 "key" => _,
                 "offset" => @first_offset,
                 "value" => %{
                   "id" => _,
                   "value" => "test value 1"
                 }
               },
               %{"headers" => %{"control" => "up-to-date"}}
             ] = Jason.decode!(conn.resp_body)
    end

    test "returns an error when table is not found", %{opts: opts} do
      conn =
        conn("GET", "/v1/shape/nonexistent?offset=-1")
        |> Router.call(opts)

      assert %{status: 400} = conn

      assert %{"root_table" => ["table not found"]} = Jason.decode!(conn.resp_body)
    end
  end
end
