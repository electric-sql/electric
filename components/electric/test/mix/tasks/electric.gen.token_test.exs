defmodule Mix.Tasks.Electric.Gen.TokenTest do
  use ExUnit.Case, async: true

  alias Mix.Tasks.Electric.Gen.Token, as: Task
  alias Electric.Satellite.{Auth, Auth.JWT}

  import ExUnit.CaptureIO

  defp validate_json_output(output, usernames, ttl) do
    assert {:ok, tokens} = Jason.decode(output)
    assert is_map(tokens)
    assert Map.keys(tokens) == usernames

    for {user_id, token_info} <- tokens do
      assert %{"token" => token, "expiry" => expiry} = token_info
      assert {:ok, %Auth{user_id: ^user_id}} = JWT.validate_token(token)
      assert {:ok, datetime, 0} = DateTime.from_iso8601(expiry)
      assert_in_delta(DateTime.diff(datetime, DateTime.utc_now()), ttl, 1)
    end
  end

  defp validate_csv_output(output, usernames, ttl) do
    lines = output |> String.trim() |> String.split()

    assert length(lines) == length(usernames)

    users =
      for line <- lines do
        assert [user_id, token, expiry] = String.split(line, ",")
        assert {:ok, %Auth{user_id: ^user_id}} = JWT.validate_token(token)
        assert {:ok, datetime, 0} = DateTime.from_iso8601(expiry)
        assert_in_delta(DateTime.diff(datetime, DateTime.utc_now()), ttl, 1)
        user_id
      end

    assert users == usernames
  end

  test "csv output" do
    {:ok, output} =
      with_io(fn ->
        Task.run(~w(--format csv user1 user2))
      end)

    validate_csv_output(output, ["user1", "user2"], Task.default_ttl())
  end

  test "json output" do
    {:ok, output} =
      with_io(fn ->
        Task.run(~w(--format json user1 user2))
      end)

    validate_json_output(output, ["user1", "user2"], Task.default_ttl())
  end

  test "csv output with custom ttl" do
    ttl = 3600

    {:ok, output} =
      with_io(fn ->
        Task.run(~w(--format csv --ttl #{ttl} user1 user2))
      end)

    validate_csv_output(output, ["user1", "user2"], ttl)
  end

  test "json output with custom ttl" do
    ttl = 3600

    {:ok, output} =
      with_io(fn ->
        Task.run(~w(--format json --ttl #{ttl} user1 user2))
      end)

    validate_json_output(output, ["user1", "user2"], ttl)
  end

  @tag :tmp_dir
  test "csv output to file", cxt do
    ttl = 3600
    path = Path.join(cxt.tmp_dir, "creds.csv")

    with_io(fn ->
      Task.run(~w(--format csv --output #{path} --ttl #{ttl} user1 user2))
    end)

    validate_csv_output(File.read!(path), ["user1", "user2"], ttl)
  end

  @tag :tmp_dir
  test "json output to file", cxt do
    ttl = 3600
    path = Path.join(cxt.tmp_dir, "creds.json")

    with_io(fn ->
      Task.run(~w(--format json --output #{path} --ttl #{ttl} user1 user2))
    end)

    validate_json_output(File.read!(path), ["user1", "user2"], ttl)
  end
end
