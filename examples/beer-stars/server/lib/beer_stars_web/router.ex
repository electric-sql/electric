defmodule BeerStarsWeb.Router do
  use BeerStarsWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", BeerStarsWeb do
    pipe_through :api

    post "/webhook", WebhookController, :create
  end

  scope "/_health", BeerStarsWeb do
    pipe_through :api

    get "/", HealthCheckController, :show
  end
end
