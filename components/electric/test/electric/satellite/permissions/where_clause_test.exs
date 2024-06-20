defmodule Electric.Satellite.Permissions.WhereClauseTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers
  alias ElectricTest.PermissionsHelpers.Chgs

  alias Electric.Satellite.Auth
  alias Electric.Satellite.Permissions

  @user_id "b2ce289a-3d2d-4ff7-9892-d446d5866f74"
  @not_user_id "ec61ba28-7195-47a2-8d93-e71068dc7160"
  @table {"public", "lotsoftypes"}

  setup do
    {:ok, schema_version} = PermissionsHelpers.Schema.load()
    auth = %Auth{user_id: @user_id}

    evaluator = Permissions.Eval.new(schema_version, auth)

    {:ok, auth: auth, schema_version: schema_version, evaluator: evaluator}
  end

  def expression(cxt, stmt) do
    assert {:ok, _expr_cxt} = Permissions.Eval.expression_context(cxt.evaluator, stmt, @table)
  end

  # execute the statement. if we pass `stmt` as a single-arity function
  # then it will be tested against all the valid prefixes for a generic
  # row, that is `this.`, `row.` and ``, this allows us to refer to
  # row columns as either `this.column`, `row.column` or just `column`
  # in where/if expressions.
  def execute(cxt, stmt, change) do
    if is_function(stmt) do
      results =
        for prefix <- ["ROW.", "THIS.", ""] do
          assert {:ok, expr_cxt} = expression(cxt, stmt.(prefix))
          assert {:ok, result} = Permissions.Eval.execute(expr_cxt, change)
          result
        end

      # make sure that all results are the same
      assert length(Enum.uniq(results)) == 1

      {:ok, hd(results)}
    else
      assert {:ok, expr_cxt} = expression(cxt, stmt)
      Permissions.Eval.execute(expr_cxt, change)
    end
  end

  def update(base, changes \\ %{}) do
    Chgs.update(@table, base, changes)
  end

  def insert(record) do
    Chgs.insert(@table, record)
  end

  def delete(record) do
    Chgs.delete(@table, record)
  end

  def change(f, r) do
    apply(__MODULE__, f, [r])
  end

  describe "UPDATE" do
    test "automatic casting when comparing auth", cxt do
      stmt = &"#{&1}user_id = AUTH.user_id"

      assert {:ok, true} = execute(cxt, stmt, update(%{"user_id" => @user_id}))
    end

    test "with NEW reference", cxt do
      stmt = "NEW.user_id = AUTH.user_id"

      assert {:ok, true} =
               execute(cxt, stmt, update(%{"user_id" => @not_user_id}, %{"user_id" => @user_id}))
    end

    test "with OLD reference", cxt do
      stmt = "OLD.user_id = auth.user_id"

      assert {:ok, true} =
               execute(cxt, stmt, update(%{"user_id" => @user_id}))

      assert {:ok, false} =
               execute(cxt, stmt, update(%{"user_id" => @not_user_id}, %{"user_id" => @user_id}))
    end

    test "with ROW reference", cxt do
      stmt = &"#{&1}user_id = auth.user_id"

      assert {:ok, true} =
               execute(cxt, stmt, update(%{"user_id" => @user_id}))

      assert {:ok, false} =
               execute(cxt, stmt, update(%{"user_id" => @not_user_id}, %{"user_id" => @user_id}))

      assert {:ok, false} =
               execute(cxt, stmt, update(%{"user_id" => @user_id}, %{"user_id" => @not_user_id}))
    end

    test "multi-clause ROW/THIS reference", cxt do
      stmt = &"(#{&1}user_id = auth.user_id) AND #{&1}valid"

      assert {:ok, true} =
               execute(
                 cxt,
                 stmt,
                 update(%{"user_id" => @user_id, "valid" => "t"})
               )

      assert {:ok, false} =
               execute(
                 cxt,
                 stmt,
                 update(%{"user_id" => @user_id, "valid" => "f"}, %{"valid" => "t"})
               )

      assert {:ok, false} =
               execute(
                 cxt,
                 stmt,
                 update(%{"user_id" => @not_user_id, "valid" => "t"}, %{"user_id" => @user_id})
               )
    end

    test "mixed row and NEW references", cxt do
      stmt = &"(#{&1}user_id = auth.user_id) AND NOT new.valid"

      assert {:ok, true} =
               execute(
                 cxt,
                 stmt,
                 update(%{"user_id" => @user_id, "valid" => "t"}, %{"valid" => "f"})
               )

      assert {:ok, false} =
               execute(
                 cxt,
                 stmt,
                 update(%{"user_id" => @user_id, "valid" => "t"})
               )

      assert {:ok, false} =
               execute(
                 cxt,
                 stmt,
                 update(%{"user_id" => @not_user_id, "valid" => "t"}, %{
                   "user_id" => @user_id,
                   "valid" => "f"
                 })
               )
    end

    test "with NEW reference to bool column", cxt do
      stmt = "new.valid"

      assert {:ok, true} =
               execute(cxt, stmt, update(%{"valid" => "t"}))

      assert {:ok, false} =
               execute(cxt, stmt, update(%{"valid" => "f"}))
    end

    test "with NOT(ROW) reference to bool column", cxt do
      stmt = &"NOT #{&1}valid"

      assert {:ok, false} =
               execute(cxt, stmt, update(%{"valid" => "t"}))

      assert {:ok, true} =
               execute(cxt, stmt, update(%{"valid" => "f"}))

      assert {:ok, false} =
               execute(cxt, stmt, update(%{"valid" => "f"}, %{"valid" => "t"}))
    end

    test "with THIS reference to bool column", cxt do
      stmt = &"#{&1}valid"

      assert {:ok, true} =
               execute(cxt, stmt, update(%{"valid" => "t"}))

      assert {:ok, false} =
               execute(cxt, stmt, update(%{"valid" => "t"}, %{"valid" => "f"}))

      assert {:ok, false} =
               execute(cxt, stmt, update(%{"valid" => "f"}, %{"valid" => "t"}))
    end
  end

  for {change_fun, name, ref} <- [
        {:insert, "INSERT", "NEW"},
        {:delete, "DELETE", "OLD"}
      ] do
    describe name do
      test "with #{ref} reference", cxt do
        stmt = "#{unquote(ref)}.user_id = AUTH.user_id"

        assert {:ok, true} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"user_id" => @user_id}))

        assert {:ok, false} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"user_id" => @not_user_id}))
      end

      test "with ROW reference", cxt do
        stmt = &"#{&1}user_id = auth.user_id"

        assert {:ok, true} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"user_id" => @user_id}))

        assert {:ok, false} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"user_id" => @not_user_id}))
      end

      test "multi-clause ROW/THIS reference", cxt do
        stmt = &"(#{&1}user_id = auth.user_id) AND #{&1}valid"

        assert {:ok, true} =
                 execute(
                   cxt,
                   stmt,
                   change(unquote(change_fun), %{"user_id" => @user_id, "valid" => "t"})
                 )

        assert {:ok, false} =
                 execute(
                   cxt,
                   stmt,
                   change(unquote(change_fun), %{"user_id" => @user_id, "valid" => "f"})
                 )

        assert {:ok, false} =
                 execute(
                   cxt,
                   stmt,
                   change(unquote(change_fun), %{"user_id" => @not_user_id, "valid" => "t"})
                 )
      end

      test "with #{ref} reference to bool column", cxt do
        stmt = "#{unquote(ref)}.valid"

        assert {:ok, true} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"valid" => "t"}))

        assert {:ok, false} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"valid" => "f"}))
      end

      test "with NOT(ROW) reference to bool column", cxt do
        stmt = &"NOT #{&1}valid"

        assert {:ok, false} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"valid" => "t"}))

        assert {:ok, true} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"valid" => "f"}))
      end

      test "with THIS reference to bool column", cxt do
        stmt = &"#{&1}valid"

        assert {:ok, true} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"valid" => "t"}))

        assert {:ok, false} =
                 execute(cxt, stmt, change(unquote(change_fun), %{"valid" => "f"}))
      end
    end
  end
end
