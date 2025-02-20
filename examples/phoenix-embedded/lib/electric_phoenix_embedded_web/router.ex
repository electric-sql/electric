defmodule Electric.PhoenixEmbeddedWeb.Router do
  use Electric.PhoenixEmbeddedWeb, :router

  import Electric.Phoenix.Router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {Electric.PhoenixEmbeddedWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
    plug :fetch_session
    plug :protect_from_forgery
  end

  pipeline :electric do
  end

  scope "/", Electric.PhoenixEmbeddedWeb do
    pipe_through :browser

    get "/", PageController, :home
  end

  scope "/api", Electric.PhoenixEmbeddedWeb do
    pipe_through :api

    resources "/todos", TodoController, except: [:new, :edit, :show]
  end

  scope "/shapes" do
    pipe_through :electric

    # Expose the "todos" table as a shape
    shape "/todos"
  end
end
