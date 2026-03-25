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

  describe "parse_top_process_limit/1" do
    import Electric.Config, only: [parse_top_process_limit: 1]

    test "parses count:<N>" do
      assert {:ok, {:count, 5}} = parse_top_process_limit("count:5")
      assert {:ok, {:count, 100}} = parse_top_process_limit("count:100")
    end

    test "parses mem_percent:<N>" do
      assert {:ok, {:mem_percent, 1}} = parse_top_process_limit("mem_percent:1")
      assert {:ok, {:mem_percent, 50}} = parse_top_process_limit("mem_percent:50")
      assert {:ok, {:mem_percent, 100}} = parse_top_process_limit("mem_percent:100")
    end

    test "rejects count:0 and negative values" do
      assert {:error, "count value must be a positive integer, got: 0"} =
               parse_top_process_limit("count:0")

      assert {:error, "count value must be a positive integer, got: -1"} =
               parse_top_process_limit("count:-1")
    end

    test "rejects mem_percent out of 1..100 range" do
      assert {:error, "mem_percent value must be between 1 and 100, got: 0"} =
               parse_top_process_limit("mem_percent:0")

      assert {:error, "mem_percent value must be between 1 and 100, got: 101"} =
               parse_top_process_limit("mem_percent:101")
    end

    test "rejects non-integer values" do
      assert {:error, "count value must be a positive integer, got: abc"} =
               parse_top_process_limit("count:abc")

      assert {:error, "mem_percent value must be between 1 and 100, got: 3.5"} =
               parse_top_process_limit("mem_percent:3.5")
    end

    test "rejects unknown format" do
      assert {:error, msg} = parse_top_process_limit("foo")
      assert msg =~ "invalid top process limit"
      assert msg =~ "Expected format: count:<N> or mem_percent:<N>"
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
