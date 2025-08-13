defmodule Burn.MemoryTest do
  use Burn.DataCase

  alias Burn.Memory

  describe "facts" do
    alias Burn.Memory.Fact

    import Burn.AccountsFixtures
    import Burn.MemoryFixtures
    import Burn.ThreadsFixtures

    setup do
      user = user_fixture()
      thread = thread_fixture()

      event =
        event_fixture(thread, user, %{
          data: %{
            "text" => "Some information about the user"
          }
        })

      %{thread: thread, source_event: event, subject: user}
    end

    @valid_attrs %{
      category: "some category",
      object: "some object",
      predicate: "some predicate",
      confidence: Decimal.new("0.9"),
      disputed: false
    }
    @valid_update_attrs %{
      category: "some updated category",
      object: "some updated object",
      predicate: "some updated predicate",
      confidence: Decimal.new("0.2"),
      disputed: true
    }
    @invalid_attrs %{
      category: nil,
      object: nil,
      predicate: nil,
      confidence: nil,
      disputed: nil
    }

    test "list_facts/0 returns all facts", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      fact = fact_fixture(thread, source_event, subject)
      assert Memory.list_facts() == [fact]
    end

    test "get_fact!/1 returns the fact with given id", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      fact = fact_fixture(thread, source_event, subject)
      assert Memory.get_fact!(fact.id) == fact
    end

    test "create_fact/1 with valid data creates a fact", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      assert {:ok, %Fact{} = fact} =
               Memory.create_fact(thread, source_event, source_event, subject, @valid_attrs)

      assert fact.category == "some category"
      assert fact.object == "some object"
      assert fact.predicate == "some predicate"
      assert fact.confidence == Decimal.new("0.9")
      assert fact.disputed == false
    end

    test "create_fact/1 with invalid data returns error changeset", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      assert {:error, %Ecto.Changeset{}} =
               Memory.create_fact(thread, source_event, source_event, subject, @invalid_attrs)
    end

    test "update_fact/2 with valid data updates the fact", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      fact = fact_fixture(thread, source_event, subject)

      assert {:ok, %Fact{} = fact} = Memory.update_fact(fact, @valid_update_attrs)
      assert fact.category == "some updated category"
      assert fact.object == "some updated object"
      assert fact.predicate == "some updated predicate"
      assert fact.confidence == Decimal.new("0.2")
      assert fact.disputed == true
    end

    test "update_fact/2 with invalid data returns error changeset", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      fact = fact_fixture(thread, source_event, subject)

      assert {:error, %Ecto.Changeset{}} = Memory.update_fact(fact, @invalid_attrs)
      assert fact == Memory.get_fact!(fact.id)
    end

    test "update_fact/2 validates confidence must be between 0 and 1", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      fact = fact_fixture(thread, source_event, subject)

      attrs = Map.put(@valid_attrs, :confidence, Decimal.new("1.1"))

      assert {:error, %Ecto.Changeset{errors: errors}} = Memory.update_fact(fact, attrs)

      max_value = Decimal.new("1.0")

      assert [
               confidence: {
                 "must be less than or equal to %{number}",
                 [
                   validation: :number,
                   kind: :less_than_or_equal_to,
                   number: ^max_value
                 ]
               }
             ] = errors
    end

    test "delete_fact/1 deletes the fact", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      fact = fact_fixture(thread, source_event, subject)

      assert {:ok, %Fact{}} = Memory.delete_fact(fact)
      assert_raise Ecto.NoResultsError, fn -> Memory.get_fact!(fact.id) end
    end

    test "change_fact/1 returns a fact changeset", %{
      thread: thread,
      source_event: source_event,
      subject: subject
    } do
      fact = fact_fixture(thread, source_event, subject)

      assert %Ecto.Changeset{} = Memory.change_fact(fact)
    end
  end
end
