defmodule Burn.AccountsTest do
  use Burn.DataCase

  alias Burn.Accounts

  import Burn.AccountsFixtures
  alias Burn.Accounts.User

  describe "get_human_user_by_name/1" do
    test "does not return the user if the name does not exist" do
      refute Accounts.get_human_user_by_name("unknown")
    end

    test "returns the user if the email exists" do
      %{id: id, name: name} = user_fixture()

      assert %User{id: ^id} = Accounts.get_human_user_by_name(name)
    end
  end

  describe "get_user!/1" do
    test "raises if id is invalid" do
      assert_raise Ecto.NoResultsError, fn ->
        Accounts.get_user!("11111111-1111-1111-1111-111111111111")
      end
    end

    test "returns the user with the given id" do
      %{id: id} = user_fixture()

      assert %User{id: ^id} = Accounts.get_user!(id)
    end
  end

  describe "create_user/1" do
    test "requires name to be set" do
      {:error, changeset} = Accounts.create_user(%{type: :human})

      assert %{name: ["can't be blank"]} = errors_on(changeset)
    end

    test "validates name length" do
      {:error, changeset} = Accounts.create_user(%{type: :human, name: "a"})

      assert %{name: ["should be at least 2 character(s)"]} = errors_on(changeset)
    end

    test "validates name format" do
      {:error, changeset} = Accounts.create_user(%{type: :human, name: "drop;tables"})

      assert "has invalid format" in errors_on(changeset).name
    end

    test "validates name uniqueness" do
      %{name: name} = user_fixture()

      {:error, changeset} = Accounts.create_user(%{type: :human, name: name})
      assert "has already been taken" in errors_on(changeset).name
    end
  end

  describe "get_or_create_human_user/1" do
    test "gets an existing user" do
      %{id: id, name: name} = user_fixture()

      assert {:ok, %User{id: ^id}} = Accounts.get_or_create_human_user(name)
    end

    test "creates a new user" do
      assert is_nil(Accounts.get_human_user_by_name("unknown"))

      assert {:ok, %User{name: "unknown"}} = Accounts.get_or_create_human_user("unknown")
    end
  end
end
