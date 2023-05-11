defmodule Electric.Satellite.Auth.JWTTest do
  use ExUnit.Case, async: true

  import Electric.Satellite.Auth.JWT, only: [build_config!: 1, validate_token: 2]
  alias Electric.Satellite.Auth
  alias Electric.Satellite.Auth.ConfigError

  @namespace "https://electric-sql.com/jwt/claims"
  @signing_key 'abcdefghijklmnopqrstuvwxyz012345' |> Enum.shuffle() |> List.to_string()

  describe "build_config!()" do
    test "returns a clean map when all checks pass" do
      opts = [
        alg: "HS256",
        key: "test key that is at least 32 characters long",
        namespace: "custom_namespace",
        iss: "test-issuer",
        extra1: "unused",
        extra2: nil
      ]

      config = build_config!(opts)
      assert is_map(config)

      assert [:alg, :joken_config, :joken_signer, :namespace, :required_claims] ==
               config |> Map.keys() |> Enum.sort()

      assert %{
               alg: "HS256",
               namespace: "custom_namespace",
               joken_config: _,
               joken_signer: _,
               required_claims: ["iat", "exp", "iss"]
             } = config
    end

    test "checks for missing 'alg'" do
      message = "Missing or invalid 'alg' configuration option for JWT auth mode"

      assert_raise ConfigError, message, fn ->
        build_config!([])
      end
    end

    test "checks for missing 'key'" do
      message = "Missing 'key' configuration option for JWT auth mode"

      assert_raise ConfigError, message, fn ->
        build_config!(alg: "HS256")
      end
    end

    test "validates the key length" do
      message = "The 'key' needs to be at least 32 bytes long for HS256"

      assert_raise ConfigError, message, fn ->
        build_config!(alg: "HS256", key: "key")
      end

      ###

      message = "The 'key' needs to be at least 48 bytes long for HS384"

      assert_raise ConfigError, message, fn ->
        build_config!(alg: "HS384", key: "key")
      end

      ###

      message = "The 'key' needs to be at least 64 bytes long for HS512"

      assert_raise ConfigError, message, fn ->
        build_config!(alg: "HS512", key: "key")
      end
    end
  end

  describe "validate_token()" do
    setup do
      claims = %{
        "iat" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "nbf" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "exp" => DateTime.to_unix(~U[2123-05-01 00:00:00Z]),
        @namespace => %{"user_id" => "12345"}
      }

      %{claims: claims}
    end

    test "successfully validates a token signed using any of the supported HS* algorithms", %{
      claims: claims
    } do
      key =
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789?!'
        |> Enum.shuffle()
        |> List.to_string()

      for alg <- ~w[HS256 HS384 HS512] do
        signer = Joken.Signer.create(alg, key)
        {:ok, token, _} = Joken.encode_and_sign(claims, signer)

        config = build_config!(alg: alg, key: key, namespace: @namespace)
        assert {alg, {:ok, %Auth{user_id: "12345"}}} == {alg, validate_token(token, config)}
      end
    end


    test "rejects a token that has no signature" do
      token = "eyJ0eXAiOiJKV1QiLCJhbGciOiJub25lIn0.e30."

      assert {:error, %Auth.TokenError{message: "Signing algorithm mismatch"}} ==
               validate_token(token, config([]))
    end
  end

  describe "validate_token(<signed token>)" do
    test "successfully extracts the namespaced user_id claim" do
      token = signed_token(claims(%{"custom_namespace" => %{"user_id" => "000"}}))

      assert {:ok, %Auth{user_id: "000"}} ==
               validate_token(token, config(namespace: "custom_namespace"))

      ###

      token = signed_token(claims(%{"user_id" => "111"}))
      assert {:ok, %Auth{user_id: "111"}} == validate_token(token, config(namespace: ""))
    end

    test "verifies that user_id is present and is not empty" do
      for claims <- [
            %{@namespace => %{}},
            %{@namespace => %{"user_id" => ""}},
            %{@namespace => %{"user_id" => 555}},
            %{"custom_namespace" => %{"user_id" => "123"}}
          ] do
        token = signed_token(claims(claims))

        assert {:error, %Auth.TokenError{message: "Missing or invalid 'user_id'"}} ==
                 validate_token(token, config(namespace: @namespace))
      end
    end

    test "validates the presence of required standard claims: iat and exp" do
      claims = %{
        "exp" => DateTime.to_unix(~U[2123-05-01 00:00:00Z]),
        "user_id" => "000"
      }

      token = signed_token(claims)

      assert {:error, %Auth.TokenError{message: ~S'Missing required "iat" claim'}} ==
               validate_token(token, config([]))

      ###

      claims = %{
        "iat" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "user_id" => "000"
      }

      token = signed_token(claims)

      assert {:error, %Auth.TokenError{message: ~S'Missing required "exp" claim'}} ==
               validate_token(token, config([]))
    end

    test "validates the iat claim" do
      token = signed_token(claims(%{"iat" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])}))

      assert {:error, %Auth.TokenError{message: ~S'Invalid "iat" claim value: ' <> _}} =
               validate_token(token, config([]))
    end

    test "validates the nbf claim" do
      token = signed_token(claims(%{"nbf" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])}))

      assert {:error, %Auth.TokenError{message: "Token is not yet valid"}} ==
               validate_token(token, config([]))
    end

    test "validates the exp claim" do
      token = signed_token(claims(%{"exp" => DateTime.to_unix(~U[2023-05-01 00:00:00Z])}))

      assert {:error, %Auth.TokenError{message: "Expired token"}} ==
               validate_token(token, config([]))
    end

    test "validates the iss claim if configured" do
      token = signed_token(claims(%{"user_id" => "111"}))

      assert {:error, %Auth.TokenError{message: ~S'Missing required "iss" claim'}} ==
               validate_token(token, config(iss: "test-issuer"))
    end

    test "validates the aud claim if configured" do
      token = signed_token(claims(%{"user_id" => "111"}))

      assert {:error, %Auth.TokenError{message: ~S'Missing required "aud" claim'}} ==
               validate_token(token, config(aud: "test-audience"))
    end

    defp signed_token(claims) do
      signer = Joken.Signer.create("HS256", @signing_key)
      {:ok, token, _} = Joken.encode_and_sign(claims, signer)
      token
    end

    defp config(opts) do
      [alg: "HS256", key: @signing_key, namespace: @namespace]
      |> Keyword.merge(opts)
      |> build_config!()
    end

    defp claims(claims) do
      valid_required_claims = %{
        "iat" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "exp" => DateTime.to_unix(~U[2123-05-01 00:00:00Z])
      }

      Map.merge(valid_required_claims, claims)
    end
  end
end
