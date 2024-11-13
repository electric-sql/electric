defmodule ApiWeb.AuthenticatorTest do
  use Api.DataCase

  alias Api.Shape
  alias ApiWeb.Authenticator

  describe "authenticator" do
    test "generate token" do
      {:ok, shape} = Shape.from(%{"table" => "foo"})

      assert %{"Authorization" => "Bearer " <> _token} =
               Authenticator.authenticate_shape(shape, nil)
    end

    test "validate token" do
      {:ok, shape} = Shape.from(%{"table" => "foo"})

      headers = Authenticator.authenticate_shape(shape, nil)
      assert Authenticator.authorise(shape, headers)
    end

    test "validate token with params" do
      {:ok, shape} =
        Shape.from(%{
          "table" => "foo",
          "where" => "value IS NOT NULL"
        })

      headers = Authenticator.authenticate_shape(shape, nil)
      assert Authenticator.authorise(shape, headers)
    end
  end
end
