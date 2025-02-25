defmodule Electric.Client.AuthenticatorTest do
  use ExUnit.Case, async: true

  alias Electric.Client
  alias Electric.Client.Authenticator.MockAuthenticator

  describe "MockAuthenticator" do
    setup do
      [
        client:
          Client.new!(
            base_url: "https://cloud.electric.com",
            authenticator: {MockAuthenticator, salt: "my-salt"}
          )
      ]
    end

    test "puts a hash into the params", ctx do
      client = Client.for_shape(ctx.client, Client.shape!("my_table"))

      request1 =
        Client.request(client,
          offset: Client.Offset.new(1234, 1),
          shape_id: "my-shape",
          live: true,
          next_cursor: 123_948
        )

      assert %{authenticated: false} = request1

      authenticated_request1 = Client.authenticate_request(client, request1)

      assert %{authenticated: true, headers: %{"electric-mock-auth" => hash1}} =
               authenticated_request1

      client = Client.for_shape(ctx.client, Client.shape!("my_table", where: "something = true"))

      request2 =
        Client.request(client,
          offset: Client.Offset.new(1235, 1),
          shape_id: "my-shape",
          live: true,
          next_cursor: 123_948
        )

      assert %{authenticated: false} = request2

      authenticated_request2 = Client.authenticate_request(client, request2)

      assert %{authenticated: true, headers: %{"electric-mock-auth" => hash2}} =
               authenticated_request2

      refute hash1 == hash2
    end
  end
end
