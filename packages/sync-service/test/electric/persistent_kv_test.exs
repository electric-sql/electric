defmodule Electric.PersistentKVTest do
  use ExUnit.Case, async: true

  alias Electric.PersistentKV, as: KV

  defp test_kv(kv) do
    key = "some/thing/here.data"
    value = :crypto.strong_rand_bytes(32)

    assert {:error, :not_found} = KV.get(kv, key)
    assert :ok = KV.set(kv, key, value)
    assert {:ok, ^value} = KV.get(kv, key)
  end

  describe "PersistentKV.Filesystem" do
    @moduletag :tmp_dir

    setup(cxt) do
      %{kv: Electric.PersistentKV.Filesystem.new!(root: cxt.tmp_dir)}
    end

    test "get and set", %{kv: kv} do
      test_kv(kv)
    end
  end

  describe "PersistentKV.Memory" do
    setup(_cxt) do
      %{kv: Electric.PersistentKV.Memory.new!()}
    end

    test "get and set", %{kv: kv} do
      test_kv(kv)
    end
  end
end
