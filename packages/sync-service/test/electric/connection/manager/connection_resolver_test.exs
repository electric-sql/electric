defmodule Electric.Connection.Manager.ConnectionResolverTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  alias Electric.Connection.Manager.ConnectionResolver

  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]
  import Support.DbSetup

  setup [
    :with_unique_db,
    :with_stack_id_from_test,
    :start_connection_resolver
  ]

  # actually connect to make sure we can do that
  # overwrite :connection_mod with custom modules that implement start_link but exit with some pre-defined postgres error
  # need to assert that the connection options are mutated between attempts
  test "valid connection opts", ctx do
    db_config = Keyword.put(ctx.db_config, :sslmode, :disable)

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ssl: false)

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  test "fallback to no-ssl works with ssmodle: :prefer", ctx do
    db_config = Keyword.put(ctx.db_config, :sslmode, :prefer)

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ssl: false)

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  test "sslmode: :require with no ssl returns error", ctx do
    db_config = Keyword.put(ctx.db_config, :sslmode, :require)

    assert {:error, %Postgrex.Error{message: "ssl not available"}} =
             ConnectionResolver.validate(ctx.stack_id, db_config)
  end

  test "connection can fallback to no ssl", ctx do
    db_config = Keyword.put(ctx.db_config, :sslmode, :prefer)

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ssl: false)

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  test "fallback to ipv4 works", ctx do
    db_config =
      Keyword.merge(ctx.db_config, ipv6: true, hostname: "local-ipv4-only.electric-sql.dev")

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ipv6: false, hostname: "local-ipv4-only.electric-sql.dev")

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  test "fallback to ipv4 handles various error results", ctx do
    # Use an IPv4 address for the hostname to ensure that connection attempts with socket_options: [:inet6] fail.
    db_config = Keyword.merge(ctx.db_config, hostname: "127.0.0.1", ipv6: true)

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ipv6: false)

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  defp start_connection_resolver(ctx) do
    _pid = start_supervised!({ConnectionResolver, stack_id: ctx.stack_id})
    :ok
  end

  defp assert_obfuscated_password(conn_opts) do
    assert is_function(Keyword.get(conn_opts, :password), 0)
  end
end
