defmodule Electric.Replication.Eval.EnvTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Env

  describe "parse_const/3" do
    setup do
      env = Env.new()
      uuid = "550e8400-e29b-41d4-a716-446655440000"
      {:ok, uuid_bytes} = Ecto.UUID.dump(uuid)
      %{env: env, uuid: uuid, uuid_bytes: uuid_bytes}
    end

    test "parses uuid values as compact 16-byte binaries", %{
      env: env,
      uuid: uuid,
      uuid_bytes: uuid_bytes
    } do
      assert {:ok, ^uuid_bytes} = Env.parse_const(env, uuid, :uuid)
      assert byte_size(uuid_bytes) == 16
    end

    test "parses uuid arrays as compact 16-byte binaries", %{
      env: env,
      uuid: uuid,
      uuid_bytes: uuid_bytes
    } do
      assert {:ok, [^uuid_bytes]} = Env.parse_const(env, "{#{uuid}}", {:array, :uuid})
    end
  end

  describe "const_to_pg_string/3" do
    setup do
      uuid = "550e8400-e29b-41d4-a716-446655440000"
      {:ok, uuid_bytes} = Ecto.UUID.dump(uuid)
      %{env: Env.new(), uuid: uuid, uuid_bytes: uuid_bytes}
    end

    test "converts text type values as-is", %{env: env} do
      assert Env.const_to_pg_string(env, "hello", :text) == "hello"
      assert Env.const_to_pg_string(env, "world", :varchar) == "world"
      assert Env.const_to_pg_string(env, "test", :name) == "test"
      assert Env.const_to_pg_string(env, "char", :bpchar) == "char"
    end

    test "converts text with special characters as-is", %{env: env} do
      assert Env.const_to_pg_string(env, "hello'world", :text) == "hello'world"
      assert Env.const_to_pg_string(env, "line\nbreak", :text) == "line\nbreak"
    end

    test "converts enum type values as-is", %{env: env} do
      assert Env.const_to_pg_string(env, "active", {:enum, :status}) == "active"
      assert Env.const_to_pg_string(env, "pending", {:enum, "my_enum"}) == "pending"
    end

    test "converts integer types using out functions", %{env: env} do
      assert Env.const_to_pg_string(env, 42, :int2) == "42"
      assert Env.const_to_pg_string(env, 100, :int4) == "100"

      assert Env.const_to_pg_string(env, 9_223_372_036_854_775_807, :int8) ==
               "9223372036854775807"
    end

    test "converts float types using out functions", %{env: env} do
      result = Env.const_to_pg_string(env, 3.14, :float4)
      assert String.starts_with?(result, "3.14")

      result = Env.const_to_pg_string(env, 2.718281828, :float8)
      assert String.starts_with?(result, "2.718")
    end

    test "converts boolean type using out function", %{env: env} do
      assert Env.const_to_pg_string(env, true, :bool) == "t"
      assert Env.const_to_pg_string(env, false, :bool) == "f"
    end

    test "converts date type using out function", %{env: env} do
      date = ~D[2025-01-15]
      assert Env.const_to_pg_string(env, date, :date) == "2025-01-15"
    end

    test "converts time type using out function", %{env: env} do
      time = ~T[14:30:00]
      assert Env.const_to_pg_string(env, time, :time) == "14:30:00"
    end

    test "converts timestamp type using out function", %{env: env} do
      timestamp = ~N[2025-01-15 14:30:00]
      assert Env.const_to_pg_string(env, timestamp, :timestamp) == "2025-01-15T14:30:00"
    end

    test "converts compact uuid values back to canonical text", %{
      env: env,
      uuid: uuid,
      uuid_bytes: uuid_bytes
    } do
      assert Env.const_to_pg_string(env, uuid_bytes, :uuid) == uuid
    end

    test "converts simple arrays of integers", %{env: env} do
      result = Env.const_to_pg_string(env, [1, 2, 3], {:array, :int4})
      assert result == "ARRAY[[123]]"
    end

    test "converts simple arrays of text", %{env: env} do
      result = Env.const_to_pg_string(env, ["a", "b", "c"], {:array, :text})
      assert result == "ARRAY[[abc]]"
    end

    test "converts simple arrays of booleans", %{env: env} do
      result = Env.const_to_pg_string(env, [true, false, true], {:array, :bool})
      assert result == "ARRAY[[tft]]"
    end

    test "converts arrays of enums", %{env: env} do
      result = Env.const_to_pg_string(env, ["active", "pending"], {:array, {:enum, :status}})
      assert result == "ARRAY[[activepending]]"
    end

    test "converts empty arrays", %{env: env} do
      result = Env.const_to_pg_string(env, [], {:array, :int4})
      assert result == "ARRAY[[]]"
    end

    test "converts single element arrays", %{env: env} do
      result = Env.const_to_pg_string(env, [42], {:array, :int4})
      assert result == "ARRAY[[42]]"
    end

    test "converts nested arrays", %{env: env} do
      result = Env.const_to_pg_string(env, [[1, 2], [3, 4]], {:array, :int4})
      # The outer list gets wrapped, and each inner list also gets wrapped
      assert result == "ARRAY[[[12][34]]]"
    end

    test "converts numeric type", %{env: env} do
      result = Env.const_to_pg_string(env, 123.456, :numeric)
      assert String.starts_with?(result, "123.456")
    end
  end
end
