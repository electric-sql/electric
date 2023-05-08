defmodule Electric.Satellite.Auth.InsecureTest do
  use ExUnit.Case, async: true

  import Electric.Satellite.Auth.Insecure, only: [validate_token: 2]
  alias Electric.Satellite.Auth

  @namespace "https://electric-sql.com/jwt/claims"

  describe "unsigned validate_token()" do
    test "successfully validates a token that has no signature" do
      claims = %{
        "iat" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "nbf" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "exp" => DateTime.to_unix(~U[2123-05-01 00:00:00Z]),
        @namespace => %{"user_id" => "12345"}
      }

      token = JWT.sign(claims, %{alg: "none"})
      assert {:ok, %Auth{user_id: "12345"}} == validate_token(token, %{namespace: @namespace})

      ###

      token = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyX2lkIjoiMCJ9"
      assert {:ok, %Auth{user_id: "0"}} == validate_token(token, %{})

      token = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyX2lkIjoiMCJ9."
      assert {:ok, %Auth{user_id: "0"}} == validate_token(token, %{})
    end

    test "successfully extracts the namespaced user_id claim" do
      claims = %{"custom_namespace" => %{"user_id" => "000"}}
      token = unsigned_token(claims)

      assert {:ok, %Auth{user_id: "000"}} ==
               validate_token(token, %{namespace: "custom_namespace"})

      claims = %{"user_id" => "111"}
      token = unsigned_token(claims)
      assert {:ok, %Auth{user_id: "111"}} == validate_token(token, %{namespace: ""})
    end

    test "validates the iat claim" do
      token = unsigned_token(%{"iat" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])})
      assert {:error, :expired} == validate_token(token, %{})
    end

    test "validates the nbf claim" do
      token = unsigned_token(%{"nbf" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])})
      assert {:error, :expired} == validate_token(token, %{})
    end

    test "validates the exp claim" do
      token = unsigned_token(%{"exp" => DateTime.to_unix(~U[2023-05-01 00:00:00Z])})
      assert {:error, :expired} == validate_token(token, %{})
    end

    test "verifies that user_id is present and is not empty" do
      for claims <- [
            %{@namespace => %{}},
            %{@namespace => %{"user_id" => ""}},
            %{@namespace => %{"user_id" => 555}},
            %{"custom_namespace" => %{"user_id" => "123"}}
          ] do
        token = unsigned_token(claims)

        assert {:error, "missing or invalid 'user_id'"} ==
                 validate_token(token, %{namespace: @namespace})
      end
    end

    defp unsigned_token(claims) do
      JWT.sign(claims, %{alg: "none"})
    end
  end

  describe "signed validate_token()" do
    test "successfully validates a signed token with no signing key configured" do
      claims = %{
        "iat" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "nbf" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "exp" => DateTime.to_unix(~U[2123-05-01 00:00:00Z]),
        @namespace => %{"user_id" => "12345"}
      }

      token =
        JWT.sign(claims, %{alg: "HS256", key: :crypto.strong_rand_bytes(16) |> Base.encode16()})

      assert {:ok, %Auth{user_id: "12345"}} == validate_token(token, %{namespace: @namespace})
    end

    test "successfully extracts the namespaced user_id claim" do
      claims = %{"custom_namespace" => %{"user_id" => "000"}}
      token = signed_token(claims)

      assert {:ok, %Auth{user_id: "000"}} ==
               validate_token(token, %{namespace: "custom_namespace"})

      claims = %{"user_id" => "111"}
      token = signed_token(claims)
      assert {:ok, %Auth{user_id: "111"}} == validate_token(token, %{namespace: ""})
    end

    test "validates the iat claim" do
      token = signed_token(%{"iat" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])})
      assert {:error, :expired} == validate_token(token, %{})
    end

    test "validates the nbf claim" do
      token = signed_token(%{"nbf" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])})
      assert {:error, :expired} == validate_token(token, %{})
    end

    test "validates the exp claim" do
      token = signed_token(%{"exp" => DateTime.to_unix(~U[2023-05-01 00:00:00Z])})
      assert {:error, :expired} == validate_token(token, %{})
    end

    test "verifies that user_id is present and is not empty" do
      for claims <- [
            %{@namespace => %{}},
            %{@namespace => %{"user_id" => ""}},
            %{@namespace => %{"user_id" => 555}},
            %{"custom_namespace" => %{"user_id" => "123"}}
          ] do
        token = signed_token(claims)

        assert {:error, "missing or invalid 'user_id'"} ==
                 validate_token(token, %{namespace: @namespace})
      end
    end

    defp signed_token(claims) do
      JWT.sign(claims, %{
        alg: "HS256",
        key: "9e17ee4b03d04cad78034b6b11e43a5134090d8cb8e815df9a96357f291a9d07"
      })
    end
  end
end
