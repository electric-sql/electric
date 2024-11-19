defmodule Support.ComponentSetup do
  alias CloudElectric.ControlPlane
  alias CloudElectric.TenantManager
  alias Electric.ShapeCache.FileStorage
  import ExUnit.Callbacks

  def make_fixed_response_control_plane(response) do
    %ControlPlane{
      base_url: "http://localhost",
      req_opts: [
        plug: fn conn ->
          conn
          |> Plug.Conn.put_resp_content_type("application/json")
          |> Plug.Conn.put_resp_header("electric-up-to-date", "true")
          |> Plug.Conn.send_resp(200, Jason.encode!(response))
        end
      ]
    }
  end

  def with_tenant_supervisor(_ctx) do
    {:ok, pid} = CloudElectric.DynamicTenantSupervisor.start_link([])
    Process.unlink(pid)

    on_exit(fn ->
      DynamicSupervisor.stop(pid, :shutdown)
    end)

    %{tenant_supervisor: pid}
  end

  def with_tenant_manager(ctx) do
    {:ok, _} =
      TenantManager.start_link(
        name: :"TenantManager:#{ctx.test}",
        long_poll_timeout: 400,
        max_age: 1,
        stale_age: 1,
        allow_shape_deletion: true,
        persistent_kv: ctx.persistent_kv,
        storage: {FileStorage, storage_dir: ctx.tmp_dir},
        pool_opts: [pool_size: 2],
        stack_overrides: [tweaks: [notify_pid: self()]]
      )

    %{tenant_manager: :"TenantManager:#{ctx.test}"}
  end

  def with_persistent_kv(_ctx) do
    kv = %Electric.PersistentKV.Memory{
      parent: self(),
      pid: start_supervised!(Electric.PersistentKV.Memory, restart: :temporary)
    }

    %{persistent_kv: kv}
  end
end
