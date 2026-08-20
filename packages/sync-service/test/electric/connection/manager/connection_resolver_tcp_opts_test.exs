defmodule Electric.Connection.Manager.ConnectionResolverTcpOptsTest do
  use ExUnit.Case, async: true

  alias Electric.Connection.Manager.ConnectionResolver

  # IPPROTO_TCP and the TCP_* option numbers from the Linux headers, as used
  # by ConnectionResolver.
  @ipproto_tcp 6
  @tcp_keepidle 4
  @tcp_keepintvl 5
  @tcp_keepcnt 6
  @tcp_user_timeout 18

  @linux {:unix, :linux}
  @darwin {:unix, :darwin}

  describe "tcp_liveness_opts/2" do
    test "returns no options when nothing is configured" do
      for os_type <- [@linux, @darwin, {:win32, :nt}] do
        assert ConnectionResolver.tcp_liveness_opts([], os_type) == []
      end
    end

    test "emits keepalive and raw options for a full configuration on Linux" do
      config = [
        keepalive_idle: 30_000,
        keepalive_interval: 5_000,
        keepalive_count: 3,
        user_timeout: 60_000
      ]

      assert ConnectionResolver.tcp_liveness_opts(config, @linux) == [
               {:keepalive, true},
               {:raw, @ipproto_tcp, @tcp_keepidle, <<30::native-32>>},
               {:raw, @ipproto_tcp, @tcp_keepintvl, <<5::native-32>>},
               {:raw, @ipproto_tcp, @tcp_keepcnt, <<3::native-32>>},
               {:raw, @ipproto_tcp, @tcp_user_timeout, <<60_000::native-32>>}
             ]
    end

    test "setting any single keepalive value enables keepalive and emits only its raw option" do
      assert ConnectionResolver.tcp_liveness_opts([keepalive_idle: 30_000], @linux) == [
               {:keepalive, true},
               {:raw, @ipproto_tcp, @tcp_keepidle, <<30::native-32>>}
             ]

      assert ConnectionResolver.tcp_liveness_opts([keepalive_interval: 5_000], @linux) == [
               {:keepalive, true},
               {:raw, @ipproto_tcp, @tcp_keepintvl, <<5::native-32>>}
             ]

      assert ConnectionResolver.tcp_liveness_opts([keepalive_count: 3], @linux) == [
               {:keepalive, true},
               {:raw, @ipproto_tcp, @tcp_keepcnt, <<3::native-32>>}
             ]
    end

    test "user timeout alone does not enable keepalive and stays in milliseconds" do
      assert ConnectionResolver.tcp_liveness_opts([user_timeout: 60_000], @linux) == [
               {:raw, @ipproto_tcp, @tcp_user_timeout, <<60_000::native-32>>}
             ]
    end

    test "keepalive idle and interval are converted to seconds, clamped to a minimum of 1" do
      assert ConnectionResolver.tcp_liveness_opts([keepalive_idle: 500], @linux) == [
               {:keepalive, true},
               {:raw, @ipproto_tcp, @tcp_keepidle, <<1::native-32>>}
             ]

      assert ConnectionResolver.tcp_liveness_opts([keepalive_interval: 1_500], @linux) == [
               {:keepalive, true},
               {:raw, @ipproto_tcp, @tcp_keepintvl, <<1::native-32>>}
             ]
    end

    test "non-Linux platforms get the portable keepalive flag but no raw options" do
      config = [
        keepalive_idle: 30_000,
        keepalive_interval: 5_000,
        keepalive_count: 3,
        user_timeout: 60_000
      ]

      for os_type <- [@darwin, {:win32, :nt}] do
        assert ConnectionResolver.tcp_liveness_opts(config, os_type) == [{:keepalive, true}]
      end
    end

    test "user timeout alone on non-Linux emits no options at all" do
      assert ConnectionResolver.tcp_liveness_opts([user_timeout: 60_000], @darwin) == []
    end
  end
end
