defmodule Electric.ConfigTest do
  use ExUnit.Case, async: true

  import Electric.Config

  doctest Electric.Config

  describe "validate_auth_config" do
    test "validates insecure mode" do
      assert {{Electric.Satellite.Auth.Insecure, %{joken_config: %{}, namespace: nil}}, []} =
               validate_auth_config("insecure", [])

      assert {{Electric.Satellite.Auth.Insecure, %{joken_config: %{}, namespace: "ns"}}, []} =
               validate_auth_config("insecure", namespace: {"AUTH_JWT_NAMESPACE", "ns"})
    end

    test "validates secure mode" do
      assert {{Electric.Satellite.Auth.Secure, %{joken_config: %{}, namespace: nil}}, []} =
               validate_auth_config("secure",
                 alg: {"AUTH_JWT_ALG", "HS256"},
                 key: {"AUTH_JWT_KEY", String.duplicate(".", 32)}
               )

      assert {{Electric.Satellite.Auth.Secure,
               %{
                 joken_config: %{},
                 namespace: "ns",
                 required_claims: ["iat", "exp", "iss", "aud"]
               }},
              []} =
               validate_auth_config("secure",
                 alg: {"AUTH_JWT_ALG", "HS256"},
                 key: {"AUTH_JWT_KEY", String.duplicate(".", 32)},
                 namespace: {"AUTH_JWT_NAMESPACE", "ns"},
                 iss: {"AUTH_JWT_ISS", "foo"},
                 aud: {"AUTH_JWT_AUD", "bar"}
               )
    end

    test "complains about invalid auth mode" do
      assert {nil,
              [
                {"AUTH_MODE",
                 {:error, "has invalid value: \"foo\". Must be one of [\"secure\", \"insecure\"]"}}
              ]} == validate_auth_config("foo", [])
    end

    test "complains about missing auth opts in secure mode" do
      assert {nil, [{"AUTH_JWT_ALG", {:error, "not set"}}]} ==
               validate_auth_config("secure", alg: {"AUTH_JWT_ALG", nil})

      assert {nil, [{"AUTH_JWT_KEY", {:error, "not set"}}]} ==
               validate_auth_config("secure",
                 alg: {"AUTH_JWT_ALG", "HS384"},
                 key: {"AUTH_JWT_KEY", nil}
               )

      assert {nil, [{"AUTH_JWT_KEY", {:error, "has to be at least 48 bytes long for HS384"}}]} ==
               validate_auth_config("secure",
                 alg: {"AUTH_JWT_ALG", "HS384"},
                 key: {"AUTH_JWT_KEY", "..."}
               )
    end
  end
end
