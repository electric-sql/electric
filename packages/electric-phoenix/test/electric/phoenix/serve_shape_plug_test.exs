defmodule Electric.Phoenix.ServeShapePlugTest do
  use ExUnit.Case, async: true
  use Plug.Test

  alias Electric.Postgres.Inspector.EtsInspector
  alias Electric.Shapes.Api
  alias Electric.Shapes.Shape
  alias Support.Mock

  import Mox
  import Support.DbSetup

  require Phoenix.ConnTest

  @endpoint Electric.Phoenix.LiveViewTest.Endpoint
  @registry __MODULE__.Registry
  @test_shape %Shape{
    root_table: {"public", "users"},
    root_table_id: :erlang.phash2({"public", "users"}),
    table_info: %{
      {"public", "users"} => %{
        columns: [
          %{name: "id", type: "int8", type_id: {20, 1}, pk_position: 0, array_dimensions: 0},
          %{name: "value", type: "text", type_id: {28, 1}, pk_position: nil, array_dimensions: 0}
        ],
        pk: ["id"]
      }
    }
  }

  Code.ensure_loaded(Support.User)

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

  def load_column_info({"public", "users"}, _),
    do: {:ok, @test_shape.table_info[{"public", "users"}][:columns]}

  def load_column_info(_, _),
    do: :table_not_found

  def load_relation(tbl, _),
    do: Support.StubInspector.load_relation(tbl, nil)

  defp full_test_name(ctx) do
    "#{ctx.module} #{ctx.test}"
  end

  defp with_stack_id_from_test(ctx) do
    stack_id = full_test_name(ctx)
    registry_name = Electric.ProcessRegistry.registry_name(stack_id)

    # registry =
    #   start_link_supervised!({Electric.ProcessRegistry, name: registry_name, stack_id: stack_id})

    [stack_id: stack_id, process_registry: registry_name]
  end

  defp with_stack(%{stack_id: stack_id} = ctx) do
    kv = %Electric.PersistentKV.Memory{
      parent: self(),
      pid: start_supervised!(Electric.PersistentKV.Memory, restart: :temporary)
    }

    storage =
      Electric.ShapeCache.Storage.shared_opts(
        {Electric.ShapeCache.InMemoryStorage,
         stack_id: stack_id, table_base_name: :"in_memory_storage_#{stack_id}"}
      )

    publication_name = "electric_test_pub_#{:erlang.phash2(stack_id)}"

    stack_events_registry = :"Registry.StackEvents:#{stack_id}"
    start_supervised!({Registry, name: stack_events_registry, keys: :duplicate})

    ref =
      Electric.StackSupervisor.subscribe_to_stack_events(stack_events_registry, stack_id)

    stack_supervisor =
      start_link_supervised!(
        {Electric.StackSupervisor,
         stack_id: stack_id,
         persistent_kv: kv,
         storage: storage,
         connection_opts: ctx.db_config,
         stack_events_registry: stack_events_registry,
         replication_opts: [
           slot_name: "electric_test_slot_#{:erlang.phash2(stack_id)}",
           publication_name: publication_name,
           try_creating_publication?: true,
           slot_temporary?: true
         ],
         pool_opts: [
           backoff_type: :stop,
           max_restarts: 0,
           pool_size: 2
         ]}
      )

    assert_receive {:stack_status, ^ref, :ready}, 2000

    %{
      registry: Electric.StackSupervisor.registry_name(stack_id),
      shape_cache: {Electric.ShapeCache, [stack_id: stack_id]},
      persistent_kv: kv,
      storage: storage,
      stack_events_registry: stack_events_registry,
      stack_supervisor: stack_supervisor,
      inspector:
        {EtsInspector, stack_id: stack_id, server: EtsInspector.name(stack_id: stack_id)},
      publication_name: publication_name
    }
  end

  # defp with_table(%{table: {name, columns}} = ctx) do
  defp with_table(ctx) do
    dbg(ctx.table)
    %{table: {name, columns}} = ctx

    sql = """
    create table "#{name}" (
    #{Enum.join(columns, ",\n")}
    );
    """

    Postgrex.query!(ctx.db_conn, sql, [])
    :ok
  end

  defp electric_opts(ctx) do
    [
      stack_id: ctx.stack_id,
      pg_id: @test_pg_id,
      stack_events_registry: ctx.stack_events_registry,
      shape_cache: ctx.shape_cache,
      storage: ctx.storage,
      inspector: ctx.inspector,
      registry: @registry,
      stack_ready_timeout: Access.get(ctx, :stack_ready_timeout, 100),
      long_poll_timeout: long_poll_timeout(ctx),
      max_age: max_age(ctx),
      stale_age: stale_age(ctx)
    ]
  end

  setup :verify_on_exit!

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  setup [:with_stack_id_from_test, :with_unique_db, :with_stack, :with_table]

  defmodule MyEnv.TestRouter do
    use Plug.Router, copy_opts_to_assign: :config
    use Electric.Phoenix.Plug.Shapes, path: "/shapes"

    plug(:match)
    plug(:dispatch)

    import Ecto.Query

    Code.ensure_loaded(Support.User)

    alias Electric.Plug.Utils.PassAssignToOptsPlug
  end

  defp with_api_server(ctx) do
    port = 33000

    # Electric.Phoenix.plug_config(
    electric_opts = Api.plug_opts(electric_opts(ctx))

    start_link_supervised!(
      {Bandit, plug: {MyEnv.TestRouter, electric: electric_opts}, port: port}
    )

    [port: port]
  end

  defp call(conn, plug \\ MyEnv.TestRouter, ctx) do
    opts = Api.plug_opts(electric_opts(ctx))

    plug.call(conn, electric: opts)
  end

  describe "Plug" do
    @tag table: {
           "things",
           ["id int8 not null primary key generated always as identity", "value text"]
         }
    test "provides the standard electric http api", ctx do
      Postgrex.query!(
        ctx.db_conn,
        """
        insert into things (value) values ('one'), ('two'), ('three');
        """,
        []
      )

      resp =
        conn(:get, "/shapes", %{"table" => "things", "offset" => "-1"})
        |> call(ctx)
        |> dbg

      assert resp.status == 200
      assert Plug.Conn.get_resp_header(resp, "electric-offset") == ["0_0"]

      assert [
               %{"headers" => %{"operation" => "insert"}, "value" => %{"value" => "one"}},
               %{"headers" => %{"operation" => "insert"}, "value" => %{"value" => "two"}},
               %{"headers" => %{"operation" => "insert"}, "value" => %{"value" => "three"}}
             ] = Jason.decode!(resp.resp_body) |> dbg
    end
  end

  describe "Phoenix" do
    @tag table: {
           "things",
           ["id int8 not null primary key generated always as identity", "value text"]
         }
    test "works" do
      resp =
        Phoenix.ConnTest.build_conn()
        |> Phoenix.ConnTest.get("/api")

      dbg(resp)
    end
  end

  defp max_age(ctx), do: Access.get(ctx, :max_age, 60)
  defp stale_age(ctx), do: Access.get(ctx, :stale_age, 300)
  defp long_poll_timeout(ctx), do: Access.get(ctx, :long_poll_timeout, 20_000)
end
