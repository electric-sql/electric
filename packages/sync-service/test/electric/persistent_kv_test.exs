defmodule Electric.PersistentKVTest do
  use ExUnit.Case,
    async: true,
    parameterize:
      for(
        mod <- [Electric.PersistentKV.Filesystem, Electric.PersistentKV.Memory],
        do: %{mod: mod}
      )

  @moduletag :tmp_dir
  setup %{mod: mod} = ctx do
    case mod do
      Electric.PersistentKV.Filesystem ->
        {:ok, %{kv: mod.new!(root: ctx.tmp_dir)}}

      Electric.PersistentKV.Memory ->
        {:ok, %{kv: mod.new!()}}
    end
  end

  alias Electric.PersistentKV, as: KV

  test "get and set", %{kv: kv} do
    key = "some/thing/here.data"
    value = :crypto.strong_rand_bytes(32)

    assert {:error, :not_found} = KV.get(kv, key)
    assert :ok = KV.set(kv, key, value)
    assert {:ok, ^value} = KV.get(kv, key)
  end

  test "get and set for non-string values", %{kv: kv} do
    key = "some/thing/here.data"
    value = 12345

    assert {:error, :not_found} = KV.get(kv, key)
    assert :ok = KV.set(kv, key, value)
    assert {:ok, ^value} = KV.get(kv, key)
  end
end
