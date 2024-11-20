defmodule ApiWeb.AuthenticatorTest do
  use Api.DataCase

  alias ApiWeb.Authenticator

  import Electric.Phoenix, only: [shape_from_params: 1]

  describe "authenticator" do
    test "generate token" do
      {:ok, shape} = shape_from_params(%{"table" => "foo"})

      assert %{"Authorization" => "Bearer " <> _token} =
               Authenticator.authentication_headers(nil, shape)
    end

    test "validate token" do
      {:ok, shape} = shape_from_params(%{"table" => "foo"})

      headers = Authenticator.authentication_headers(nil, shape)
      assert Authenticator.authorize(shape, headers)
    end

    test "validate token with params" do
      {:ok, shape} =
        shape_from_params(%{
          "table" => "foo",
          "where" => "value IS NOT NULL"
        })

      headers = Authenticator.authentication_headers(nil, shape)
      assert Authenticator.authorize(shape, headers)
    end
  end
end
