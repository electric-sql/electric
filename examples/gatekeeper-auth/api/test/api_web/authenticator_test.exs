defmodule ApiWeb.AuthenticatorTest do
  use Api.DataCase

  alias Api.Shape
  alias ApiWeb.Authenticator

  describe "authenticator" do
    test "generate token" do
      {:ok, shape} = Shape.from(%{"table" => "foo"})

      assert %{"Authorization" => "Bearer " <> _token} =
               Authenticator.authentication_headers(nil, shape)
    end

    test "validate token" do
      {:ok, shape} = Shape.from(%{"table" => "foo"})

      headers = Authenticator.authentication_headers(nil, shape)
      assert Authenticator.authorize(shape, headers)
    end

    test "validate token with params" do
      {:ok, shape} =
        Shape.from(%{
          "table" => "foo",
          "where" => "value IS NOT NULL"
        })

      headers = Authenticator.authentication_headers(nil, shape)
      assert Authenticator.authorize(shape, headers)
    end
  end
end
