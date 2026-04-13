defmodule Electric.LiveDashboardRouter do
  @moduledoc """
  Phoenix Router for LiveDashboard.
  Mounts the dashboard at the root path.
  """

  use Phoenix.Router
  import Phoenix.LiveDashboard.Router

  pipeline :browser do
    plug :accepts, ["html", "json"]
    plug :fetch_session
    plug :put_root_layout, html: {Phoenix.LiveDashboard.LayoutView, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  scope "/" do
    pipe_through :browser

    # Handle favicon requests gracefully
    get "/favicon.ico", Electric.FaviconController, :show

    live_dashboard "/", ecto_repos: []

  end
end
