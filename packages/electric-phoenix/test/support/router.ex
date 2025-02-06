defmodule Electric.Phoenix.LiveViewTest.Router do
  use Phoenix.Router

  import Phoenix.LiveView.Router

  pipeline :setup_session do
    plug(Plug.Session,
      store: :cookie,
      key: "_live_view_key",
      signing_salt: "/VEDsdfsffMnp5"
    )

    plug(:fetch_session)
  end

  pipeline :browser do
    plug(:setup_session)
    plug(:accepts, ["html"])
    plug(:fetch_live_flash)
  end

  scope "/", Electric.Phoenix.LiveViewTest do
    pipe_through([:browser])

    live("/stream", StreamLive)
    live("/stream/with-component", StreamLiveWithComponent)
  end

  scope "/" do
    pipe_through([:browser])

    get("/shape/items", Electric.Phoenix.Plug,
      shape: Electric.Client.shape!("items", where: "visible = true")
    )

    get("/shape/generic", Electric.Phoenix.Plug, [])
  end

  scope "/api" do
    pipe_through([:browser])

    forward("/", Electric.Phoenix.Plug.Shapes, [])
  end
end
