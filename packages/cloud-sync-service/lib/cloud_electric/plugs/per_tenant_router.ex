defmodule CloudElectric.Plugs.PerTenantRouter do
  alias Electric.Plug.Utils.PassAssignToOptsPlug
  alias CloudElectric.Plugs.LoadTenantToAssignPlug
  use Plug.Router

  plug :match
  plug LoadTenantToAssignPlug, assign_as: :config
  plug :dispatch

  get "/shape",
    to: PassAssignToOptsPlug,
    init_opts: [plug: Electric.Plug.ServeShapePlug, assign_key: :config]

  delete "/shape",
    to: PassAssignToOptsPlug,
    init_opts: [plug: Electric.Plug.DeleteShapePlug, assign_key: :config]

  options "/shape", to: Electric.Plug.OptionsShapePlug

  get "/health", to: Electric.Plug.HealthCheckPlug

  match _, do: send_resp(conn, 404, ~S|"Not found"|)
end
