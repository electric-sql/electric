defmodule Electric.ConfigTest do
  use ExUnit.Case, async: false

  doctest Electric.Config, import: true

  describe "validate_security_config!/2" do
    test "raises error when neither secret nor insecure mode are set" do
      assert_raise RuntimeError,
                   ~r/You must set ELECTRIC_SECRET unless ELECTRIC_INSECURE=true. Setting ELECTRIC_INSECURE=true risks exposing your database, only use insecure mode in development or you've otherwise secured the Electric API/,
                   fn ->
                     Electric.Config.validate_security_config!(nil, false)
                   end
    end

    test "raises error when both secret and insecure mode are set" do
      assert_raise RuntimeError,
                   ~r/You cannot set both ELECTRIC_SECRET and ELECTRIC_INSECURE=true/,
                   fn ->
                     Electric.Config.validate_security_config!("secret", true)
                   end
    end

    test "accepts valid secure configuration" do
      assert :ok = Electric.Config.validate_security_config!("secret", false)
    end

    test "accepts valid insecure configuration" do
      assert :ok = Electric.Config.validate_security_config!(nil, true)
    end
  end

  describe "defaults" do
    # want to know what happens without our runtime environment
    # if any of the configuration options are missing defaults
    # then these configuration functions will raise
    setup do
      initial_config = Application.get_all_env(:electric)

      for {key, _} <- initial_config do
        Application.delete_env(:electric, key)
      end

      on_exit(fn ->
        Application.put_all_env([{:electric, initial_config}])
      end)

      [initial_config: initial_config]
    end

    test "api_server/0" do
      Electric.Application.api_server()
    end

    test "configuration/1", ctx do
      Electric.Application.configuration(
        Keyword.take(ctx.initial_config, [:replication_connection_opts])
      )
    end

    test "api/0" do
      Electric.Application.api()
    end

    test "api_plug_opts/0" do
      Electric.Application.api_plug_opts()
    end
  end

  describe "validations" do
    test "configuring deprecated FileStorage raises" do
      assert_raise RuntimeError, ~r/FileStorage storage is deprecated/, fn ->
        Electric.Application.configuration(
          storage: {Electric.ShapeCache.FileStorage, storage_dir: "./persistent"}
        )
      end
    end
  end
end
