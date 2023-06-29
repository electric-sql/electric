defmodule Electric.Satellite.Auth.InsecureTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  import Electric.Satellite.Auth.Insecure, only: [validate_token: 2]
  alias Electric.Satellite.Auth

  @namespace "https://electric-sql.com/jwt/claims"
  @signing_key 'abcdefghijklmnopqrstuvwxyz012345' |> Enum.shuffle() |> List.to_string()

  describe "validate_token()" do
    property "rejects malformed tokens" do
      check all(token <- StreamData.string(:printable)) do
        assert {:error, %Auth.TokenError{message: "Invalid token"}} ==
                 validate_token(token, config([]))
      end
    end
  end

  describe "unsigned validate_token()" do
    test "successfully validates a token that has no signature" do
      claims = %{
        "iat" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "nbf" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "exp" => DateTime.to_unix(~U[2123-05-01 00:00:00Z]),
        @namespace => %{"user_id" => "12345"}
      }

      token = unsigned_token(claims)

      assert {:ok, %Auth{user_id: "12345"}} ==
               validate_token(token, config(namespace: @namespace))

      ###

      claims = %{"user_id" => "0"}
      token = unsigned_token(claims)
      assert {:ok, %Auth{user_id: "0"}} == validate_token(token, config([]))
    end

    test "successfully extracts the namespaced user_id claim" do
      claims = %{"custom_namespace" => %{"user_id" => "000"}}
      token = unsigned_token(claims)

      assert {:ok, %Auth{user_id: "000"}} ==
               validate_token(token, config(namespace: "custom_namespace"))

      claims = %{"user_id" => "111"}
      token = unsigned_token(claims)
      assert {:ok, %Auth{user_id: "111"}} == validate_token(token, config(namespace: ""))
    end

    test "validates the iat claim" do
      token = unsigned_token(%{"iat" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])})

      assert {:error, %Auth.TokenError{message: ~S'Invalid "iat" claim value: ' <> _}} =
               validate_token(token, config([]))
    end

    test "validates the nbf claim" do
      token = unsigned_token(%{"nbf" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])})

      assert {:error, %Auth.TokenError{message: "Token is not yet valid"}} ==
               validate_token(token, config([]))
    end

    test "validates the exp claim" do
      token = unsigned_token(%{"exp" => DateTime.to_unix(~U[2023-05-01 00:00:00Z])})

      assert {:error, %Auth.TokenError{message: "Expired token"}} ==
               validate_token(token, config([]))
    end

    test "verifies that user_id is present and is not empty" do
      for claims <- [
            %{@namespace => %{}},
            %{@namespace => %{"user_id" => ""}},
            %{@namespace => %{"user_id" => 555}},
            %{"custom_namespace" => %{"user_id" => "123"}}
          ] do
        token = unsigned_token(claims)

        assert {:error, %Auth.TokenError{message: "Missing or invalid 'user_id'"}} ==
                 validate_token(token, config(namespace: @namespace))
      end
    end

    defp unsigned_token(claims) do
      # With yajwt it was possible to simply call
      #
      #     JWT.sign(claims, %{alg: "none"})
      #
      # But Joken does not support the "none" signing algorithm. Hence the manual encoding.
      header = encode_part(%{typ: "JWT", alg: "none"})
      payload = encode_part(claims)
      header <> "." <> payload <> "."
    end

    defp encode_part(map) do
      map
      |> Jason.encode!()
      |> Base.url_encode64(padding: false)
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

      token = signed_token(claims)

      assert {:ok, %Auth{user_id: "12345"}} ==
               validate_token(token, config(namespace: @namespace))
    end

    test "successfully extracts the namespaced user_id claim" do
      claims = %{"custom_namespace" => %{"user_id" => "000"}}
      token = signed_token(claims)

      assert {:ok, %Auth{user_id: "000"}} ==
               validate_token(token, config(namespace: "custom_namespace"))

      claims = %{"user_id" => "111"}
      token = signed_token(claims)
      assert {:ok, %Auth{user_id: "111"}} == validate_token(token, config(namespace: ""))
    end

    test "validates the iat claim" do
      token = signed_token(%{"iat" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])})

      assert {:error, %Auth.TokenError{message: ~S'Invalid "iat" claim value: ' <> _}} =
               validate_token(token, config([]))
    end

    test "validates the nbf claim" do
      token = signed_token(%{"nbf" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])})

      assert {:error, %Auth.TokenError{message: "Token is not yet valid"}} ==
               validate_token(token, config([]))
    end

    test "validates the exp claim" do
      token = signed_token(%{"exp" => DateTime.to_unix(~U[2023-05-01 00:00:00Z])})

      assert {:error, %Auth.TokenError{message: "Expired token"}} ==
               validate_token(token, config([]))
    end

    test "verifies that user_id is present and is not empty" do
      for claims <- [
            %{@namespace => %{}},
            %{@namespace => %{"user_id" => ""}},
            %{@namespace => %{"user_id" => 555}},
            %{"custom_namespace" => %{"user_id" => "123"}}
          ] do
        token = signed_token(claims)

        assert {:error, %Auth.TokenError{message: "Missing or invalid 'user_id'"}} ==
                 validate_token(token, config(namespace: @namespace))
      end
    end

    defp signed_token(claims) do
      signer = Joken.Signer.create("HS256", @signing_key)
      {:ok, token, _claims} = Joken.encode_and_sign(claims, signer)
      token
    end
  end

  defp config(opts) do
    Auth.Insecure.build_config(opts)
  end
end
