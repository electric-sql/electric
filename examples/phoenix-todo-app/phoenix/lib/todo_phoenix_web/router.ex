defmodule TodoPhoenixWeb.Router do
  use TodoPhoenixWeb, :router
  import Plug.Conn
  import Phoenix.Sync.Router

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :browser do
    plug :accepts, ["html"]
    plug :put_secure_browser_headers
  end

  # Traditional API routes for writes
  scope "/api", TodoPhoenixWeb do
    pipe_through :api

    get "/health", HealthController, :check
    options "/*path", HealthController, :options

    # Standard CRUD operations
    resources "/todos", TodoController, except: [:new, :edit]
  end

  # Phoenix.Sync shapes endpoints
  scope "/", TodoPhoenixWeb do
    pipe_through :api

    # Shape endpoint for todos
    sync "/shapes/todos", query: TodoPhoenix.Todos.Todo
  end

  # Health check endpoint
  scope "/", TodoPhoenixWeb do
    pipe_through :api
    get "/health", HealthController, :check
  end

  # Serve React SPA (this must be last)
  scope "/", TodoPhoenixWeb do
    pipe_through :browser

    # Catch-all route for React SPA
    get "/*path", PageController, :index
  end
end
