defmodule BurnWeb.Router do
  use BurnWeb, :router

  import BurnWeb.Auth
  import Phoenix.Sync.Router, only: [sync: 2]

  alias Burn.{
    Accounts,
    Memory,
    Threads
  }

  pipeline :browser do
    plug :accepts, ["html"]
    plug :put_root_layout, html: {BurnWeb.Layouts, :root}
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  pipeline :auth do
    plug :fetch_api_user
    plug :require_authenticated_user
  end

  ## Authentication routes

  scope "/auth", BurnWeb do
    pipe_through :api

    post "/sign-in", AuthController, :sign_in
  end

  scope "/ingest", BurnWeb do
    pipe_through [:api, :auth]

    post "/mutations", IngestController, :ingest
  end

  scope "/sync" do
    pipe_through [:api, :auth]

    sync "/users", Accounts.User
    sync "/threads", Threads.Thread
    sync "/memberships", Threads.Membership
    sync "/events", Threads.Event
    sync "/facts", Memory.Fact
  end

  scope "/", BurnWeb do
    pipe_through :browser

    get "/*path", PageController, :home
  end
end
