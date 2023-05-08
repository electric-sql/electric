defmodule Electric.Satellite.Auth.JWTTest do
  use ExUnit.Case, async: true

  import Electric.Satellite.Auth.JWT, only: [validate_config!: 1]
  alias Electric.Satellite.Auth.ConfigError

  describe "validate_config!()" do
    test "returns a clean map when all checks pass" do
      key = "test key that is at least 32 characters long"
      opts = [issuer: "test-issuer", secret_key: key, extra1: "unused", extra2: nil]
      assert %{issuer: "test-issuer", secret_key: key} == validate_config!(opts)
    end

    test "checks for missing 'issuer'" do
      message = "Missing 'issuer' configuration option for JWT auth mode"

      assert_raise ConfigError, message, fn ->
        validate_config!(secret_key: "test key that is at least 32 characters long")
      end
    end

    test "checks for missing 'secret_key'" do
      message = "Missing 'secret_key' configuration option for JWT auth mode"

      assert_raise ConfigError, message, fn ->
        validate_config!(issuer: "test-issuer")
      end
    end

    test "validates secret key length" do
      key = "key"
      message = "The secret key value needs to be 32 bytes or greater for JWT auth mode"

      assert_raise ConfigError, message, fn ->
        validate_config!(issuer: "test-issuer", secret_key: key)
      end
    end
  end
end
