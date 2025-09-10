defmodule Electric.Connection.Manager.ConnectionResolverTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  alias Electric.Connection.Manager.ConnectionResolver

  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]
  import Support.DbSetup

  defp start_connection_resolver!(ctx, connection_mod \\ nil) do
    opts = [stack_id: ctx.stack_id]

    opts =
      if connection_mod do
        Keyword.put(opts, :connection_mod, connection_mod)
      else
        opts
      end

    start_supervised!({ConnectionResolver, opts})
  end

  setup [
    :with_unique_db,
    :with_stack_id_from_test
  ]

  defmodule ErrorConnection do
    def start_link(_handler, _args, conn_opts, match_fun) do
      match_fun.(conn_opts)
    end
  end

  defp assert_obfuscated_password(conn_opts) do
    assert is_function(Keyword.get(conn_opts, :password), 0)
  end

  # actually connect to make sure we can do that
  # overwrite :connection_mod with custom modules that implement start_link but exit with some pre-defined postgres error
  # need to assert that the connection options are mutated between attempts
  test "valid connection opts", ctx do
    start_connection_resolver!(ctx)

    db_config = Keyword.put(ctx.db_config, :sslmode, :disable)

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ssl: false)

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  test "fallback to no-ssl works with ssmodle: :prefer", ctx do
    start_connection_resolver!(ctx)

    db_config = Keyword.put(ctx.db_config, :sslmode, :prefer)

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ssl: false)

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  test "sslmode: :require with no ssl returns error", ctx do
    start_connection_resolver!(ctx)
    db_config = Keyword.put(ctx.db_config, :sslmode, :require)

    assert {:error, %Postgrex.Error{message: "ssl not available"}} =
             ConnectionResolver.validate(ctx.stack_id, db_config)
  end

  test "fly connection can fallback to no ssl", ctx do
    conn = spawn(fn -> Process.sleep(:infinity) end)

    start_connection_resolver!(
      ctx,
      {ErrorConnection, :start_link,
       [
         fn conn_opts ->
           if Keyword.get(conn_opts, :ssl) do
             {:error,
              %DBConnection.ConnectionError{
                message: "ssl connect: closed",
                severity: :error
              }}
           else
             {:ok, conn}
           end
         end
       ]}
    )

    db_config = Keyword.put(ctx.db_config, :sslmode, :prefer)

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ssl: false)

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  test "fallback to ipv4 works", ctx do
    start_connection_resolver!(ctx)

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
    conn = spawn(fn -> Process.sleep(:infinity) end)

    start_connection_resolver!(
      ctx,
      {ErrorConnection, :start_link,
       [
         fn conn_opts ->
           if Keyword.get(conn_opts, :ipv6, true) do
             {:error,
              %DBConnection.ConnectionError{
                message: ipv6_error_message("localhost"),
                severity: :error
              }}
           else
             {:ok, conn}
           end
         end
       ]}
    )

    db_config = Keyword.put(ctx.db_config, :ipv6, true)

    assert {:ok, resolved_db_config} = ConnectionResolver.validate(ctx.stack_id, db_config)

    expected = Keyword.merge(db_config, ipv6: false)

    for {k, v} <- expected do
      assert Keyword.get(resolved_db_config, k) == v
    end

    assert_obfuscated_password(resolved_db_config)
  end

  defp ipv6_error_message(hostname) do
    "tcp connect (#{hostname}): " <>
      Enum.random([
        "non-existing domain - :nxdomain",
        "host is unreachable - :ehostunreach",
        "network is unreachable - :enetunreach"
      ])
  end
end
