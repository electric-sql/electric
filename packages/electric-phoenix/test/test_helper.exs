# Application.put_env(:electric_phoenix, Electric.Phoenix.LiveViewTest.Endpoint,
#   http: [ip: {127, 0, 0, 1}, port: 4004],
#   adapter: Bandit.PhoenixAdapter,
#   server: true,
#   live_view: [signing_salt: "aaaaaaaa"],
#   secret_key_base: String.duplicate("a", 64),
#   render_errors: [
#     formats: [
#       html: Phoenix.LiveViewTest.E2E.ErrorHTML
#     ],
#     layout: false
#   ],
#   pubsub_server: Phoenix.LiveViewTest.E2E.PubSub,
#   debug_errors: false
# )

{:ok, _} = Electric.Phoenix.LiveViewTest.Endpoint.start_link()
ExUnit.start()
