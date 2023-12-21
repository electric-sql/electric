defmodule Electric.ConfigTest do
  use ExUnit.Case, async: true

  import Electric.Config

  doctest Electric.Config

  describe "format_required_config_error" do
    test "complains about missing required values" do
      write_to_pg_mode_config = parse_write_to_pg_mode("logical_replication")

      error_str =
        format_required_config_error(
          DATABASE_URL: parse_database_url(nil, :prod),
          LOGICAL_PUBLISHER_HOST: parse_logical_publisher_host(nil, write_to_pg_mode_config),
          PG_PROXY_PASSWORD: parse_pg_proxy_password(nil)
        )
        |> IO.iodata_to_binary()

      assert error_str =~ "CONFIGURATION ERROR"
      assert error_str =~ "DATABASE_URL not set"
      assert error_str =~ "LOGICAL_PUBLISHER_HOST not set"
      assert error_str =~ "PG_PROXY_PASSWORD not set"
    end

    test "complains about invalid values" do
      error_str =
        format_required_config_error(
          DATABASE_URL: parse_database_url("psql://localhost", :prod),
          ELECTRIC_WRITE_TO_PG_MODE: parse_write_to_pg_mode("foo"),
          LOG_LEVEL: parse_log_level("absolute"),
          PG_PROXY_PORT: parse_pg_proxy_port("https:443", 1)
        )
        |> IO.iodata_to_binary()

      assert error_str =~ "CONFIGURATION ERROR"
      assert error_str =~ "DATABASE_URL has invalid URL scheme: \"psql\""

      assert error_str =~
               "ELECTRIC_WRITE_TO_PG_MODE has invalid value: \"foo\". " <>
                 "Must be one of [\"direct_writes\", \"logical_replication\"]"

      assert error_str =~
               "LOG_LEVEL has invalid value: \"absolute\". " <>
                 "Must be one of [\"error\", \"warning\", \"info\", \"debug\"]"
    end
  end

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

  describe "parse_pg_proxy_port" do
    test "uses default value if no value is set" do
      port = :rand.uniform(65535)
      assert {false, {:ok, port}} == parse_pg_proxy_port(nil, port)
    end

    test "validates valid port numbers" do
      port = :rand.uniform(65535)
      assert {false, {:ok, port}} == parse_pg_proxy_port(to_string(port), 1)
    end

    test "validates the http prefix" do
      port = :rand.uniform(65536)
      assert {true, {:ok, port}} == parse_pg_proxy_port("http", port)
      assert {true, {:ok, 12345}} == parse_pg_proxy_port("hTTp:12345", port)
    end

    test "complains about invalid port numbers" do
      assert {false, {:error, "has invalid value: \"foo\""}} == parse_pg_proxy_port("foo", 1)
    end
  end
end
