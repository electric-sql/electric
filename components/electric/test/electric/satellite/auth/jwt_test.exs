defmodule Electric.Satellite.Auth.JWTTest do
  use ExUnit.Case, async: true

  import Electric.Satellite.Auth.JWT, only: [build_config!: 1, validate_token: 2]
  alias Electric.Satellite.Auth
  alias Electric.Satellite.Auth.ConfigError

  @namespace "https://electric-sql.com/jwt/claims"

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
end
