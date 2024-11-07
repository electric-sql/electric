defmodule Electric.PhoenixExampleWeb.Router do
  use Electric.PhoenixExampleWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {Electric.PhoenixExampleWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", Electric.PhoenixExampleWeb do
    pipe_through :browser

    live "/", TodoLive.Index, :index
  end

  # Other scopes may use custom stacks.
  # scope "/api", Electric.PhoenixExampleWeb do
  #   pipe_through :api
  # end
end
