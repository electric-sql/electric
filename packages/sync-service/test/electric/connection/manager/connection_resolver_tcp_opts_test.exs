defmodule Electric.Connection.Manager.ConnectionResolverTcpOptsTest do
  # Verifies that the TCP liveness options configured via `tcp_opts` reach the
  # kernel with the expected values, and that leaving them unset keeps the OS
  # defaults untouched. Values are read back through raw `getsockopt` calls, so
  # the test only runs on Linux where the option numbers below are valid.
  use ExUnit.Case, async: true

  alias Electric.Connection.Manager.ConnectionResolver

  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]

  # IPPROTO_TCP from netinet/in.h, TCP_* from netinet/tcp.h.
  @ipproto_tcp 6
  @tcp_keepidle 4
  @tcp_keepintvl 5
  @tcp_keepcnt 6
  @tcp_user_timeout 18

  @raw_opts [
    {:raw, @ipproto_tcp, @tcp_keepidle, 4},
    {:raw, @ipproto_tcp, @tcp_keepintvl, 4},
    {:raw, @ipproto_tcp, @tcp_keepcnt, 4},
    {:raw, @ipproto_tcp, @tcp_user_timeout, 4}
  ]

  if :os.type() != {:unix, :linux} do
    @moduletag skip: "raw TCP socket option numbers are Linux-specific"
  end

  setup :with_stack_id_from_test

  # Stands in for Postgrex.SimpleConnection: reports the socket options the
  # resolver would pass to the real connection, then fails so the resolver
  # returns without connecting anywhere.
  defmodule CapturingConnection do
    def start_link(_handler, _args, conn_opts, test_pid) do
      send(test_pid, {:socket_options, Keyword.fetch!(conn_opts, :socket_options)})
      {:error, %DBConnection.ConnectionError{message: "captured", severity: :info}}
    end
  end

  defp resolved_socket_options(ctx, tcp_opts) do
    start_supervised!(
      {ConnectionResolver,
       stack_id: ctx.stack_id,
       tcp_opts: tcp_opts,
       connection_mod: {CapturingConnection, :start_link, [self()]}}
    )

    conn_opts = [
      hostname: "localhost",
      port: 5432,
      database: "db",
      username: "user",
      password: fn -> "pass" end,
      sslmode: :disable
    ]

    assert {:error, _} = ConnectionResolver.validate(ctx.stack_id, conn_opts)
    assert_receive {:socket_options, socket_options}
    socket_options
  end

  # Opens a loopback connection with the given socket options and returns the
  # client-side socket, mirroring how Postgrex passes :socket_options to
  # :gen_tcp.connect/3.
  defp connect_loopback(socket_options) do
    {:ok, listen} = :gen_tcp.listen(0, ip: {127, 0, 0, 1})
    {:ok, port} = :inet.port(listen)
    {:ok, socket} = :gen_tcp.connect({127, 0, 0, 1}, port, socket_options ++ [active: false])
    socket
  end

  defp kernel_values(socket) do
    {:ok, values} = :inet.getopts(socket, [:keepalive | @raw_opts])
    values
  end

  test "configured values are applied to the socket", ctx do
    socket_options =
      resolved_socket_options(ctx,
        keepalive_idle: 33_000,
        keepalive_interval: 7_000,
        keepalive_count: 5,
        user_timeout: 45_678
      )

    assert [
             {:keepalive, true},
             {:raw, @ipproto_tcp, @tcp_keepidle, <<33::native-32>>},
             {:raw, @ipproto_tcp, @tcp_keepintvl, <<7::native-32>>},
             {:raw, @ipproto_tcp, @tcp_keepcnt, <<5::native-32>>},
             {:raw, @ipproto_tcp, @tcp_user_timeout, <<45_678::native-32>>}
           ] = socket_options |> connect_loopback() |> kernel_values()
  end

  test "unset options leave the OS defaults in place", ctx do
    socket_options = resolved_socket_options(ctx, [])
    assert socket_options == []

    # Compare against a socket opened with no options at all rather than
    # against hard-coded numbers: the defaults come from the host's sysctls.
    assert socket_options |> connect_loopback() |> kernel_values() ==
             [] |> connect_loopback() |> kernel_values()
  end

  test "setting a single keepalive option enables keepalive and leaves the rest at defaults",
       ctx do
    [{:keepalive, false} | defaults] = [] |> connect_loopback() |> kernel_values()

    [{:keepalive, true} | values] =
      resolved_socket_options(ctx, keepalive_count: 2) |> connect_loopback() |> kernel_values()

    expected =
      List.keyreplace(
        defaults,
        @tcp_keepcnt,
        2,
        {:raw, @ipproto_tcp, @tcp_keepcnt, <<2::native-32>>}
      )

    assert values == expected
  end
end
