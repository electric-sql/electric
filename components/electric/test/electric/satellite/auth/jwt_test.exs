defmodule Electric.Satellite.Auth.JWTTest do
  use ExUnit.Case, async: true

  import Electric.Satellite.Auth.JWT, only: [build_config!: 1]
  alias Electric.Satellite.Auth.ConfigError

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
end
