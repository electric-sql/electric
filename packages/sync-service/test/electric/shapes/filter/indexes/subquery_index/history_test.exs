defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex.HistoryTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.History

  describe "new/0" do
    test "is the empty history — member at every retained time" do
      assert History.new() == []
    end
  end

  describe "member?/2" do
    test "[] is in at every time" do
      assert History.member?([], 0)
      assert History.member?([], 1_000)
    end

    test "nil is out at every time" do
      refute History.member?(nil, 0)
      refute History.member?(nil, 1_000)
    end

    test "[:out, t] is out before t and in from t onwards" do
      h = [:out, 9]

      refute History.member?(h, 0)
      refute History.member?(h, 8)
      assert History.member?(h, 9)
      assert History.member?(h, 100)
    end

    test "[:in, t] is in before t and out from t onwards" do
      h = [:in, 9]

      assert History.member?(h, 0)
      assert History.member?(h, 8)
      refute History.member?(h, 9)
      refute History.member?(h, 100)
    end

    test "[:out, a, b] toggles in at a then out at b" do
      h = [:out, 9, 11]

      refute History.member?(h, 8)
      assert History.member?(h, 9)
      assert History.member?(h, 10)
      refute History.member?(h, 11)
      refute History.member?(h, 100)
    end

    test "[:in, a, b] toggles out at a then in at b" do
      h = [:in, 9, 11]

      assert History.member?(h, 8)
      refute History.member?(h, 9)
      refute History.member?(h, 10)
      assert History.member?(h, 11)
      assert History.member?(h, 100)
    end
  end

  describe "member_at_some_time?/1" do
    test "true for any non-nil history" do
      assert History.member_at_some_time?([])
      assert History.member_at_some_time?([:out, 9])
      assert History.member_at_some_time?([:in, 9])
      assert History.member_at_some_time?([:out, 9, 11])
      assert History.member_at_some_time?([:in, 9, 11])
    end

    test "false for nil" do
      refute History.member_at_some_time?(nil)
    end
  end

  describe "member_at_all_times?/1" do
    test "true only for the empty history" do
      assert History.member_at_all_times?([])
    end

    test "false for any history with toggles, and for nil" do
      refute History.member_at_all_times?(nil)
      refute History.member_at_all_times?([:out, 9])
      refute History.member_at_all_times?([:in, 9])
      refute History.member_at_all_times?([:out, 9, 11])
      refute History.member_at_all_times?([:in, 9, 11])
    end
  end

  describe "mark_in/2" do
    test "promotes nil to [:out, t] — a value seen for the first time" do
      assert History.mark_in(nil, 5) == [:out, 5]
    end

    test "leaves [] alone — already in" do
      assert History.mark_in([], 5) == []
    end

    test "appends a toggle when current state is :out" do
      assert History.mark_in([:in, 5], 10) == [:in, 5, 10]
      assert History.mark_in([:out, 5, 8], 10) == [:out, 5, 8, 10]
    end

    test "is a no-op when current state is already :in" do
      assert History.mark_in([:out, 5], 10) == [:out, 5]
      assert History.mark_in([:in, 5, 8], 10) == [:in, 5, 8]
    end
  end

  describe "mark_out/2" do
    test "is a no-op on nil — there is nothing to remove" do
      assert History.mark_out(nil, 5) == nil
    end

    test "transitions [] to [:in, t] — out of the always-in baseline" do
      assert History.mark_out([], 5) == [:in, 5]
    end

    test "appends a toggle when current state is :in" do
      assert History.mark_out([:out, 5], 10) == [:out, 5, 10]
      assert History.mark_out([:in, 5, 8], 10) == [:in, 5, 8, 10]
    end

    test "is a no-op when current state is already :out" do
      assert History.mark_out([:in, 5], 10) == [:in, 5]
      assert History.mark_out([:out, 5, 8], 10) == [:out, 5, 8]
    end
  end

  describe "compact/2" do
    test "[] always stays []" do
      assert History.compact([], 0) == []
      assert History.compact([], 1_000_000) == []
    end

    test "nil always stays nil" do
      assert History.compact(nil, 0) == nil
      assert History.compact(nil, 1_000_000) == nil
    end

    test "keeps everything when min_required_time precedes the first toggle" do
      assert History.compact([:out, 9, 11], 8) == [:out, 9, 11]
      assert History.compact([:in, 9], 0) == [:in, 9]
    end

    test "folds a toggle at min_required_time into the initial state" do
      # [:out, 9]: out before 9, in from 9 onwards.
      # retain from 9 onwards -> always in.
      assert History.compact([:out, 9], 9) == []

      # [:in, 11]: in before 11, out from 11 onwards.
      # retain from 11 onwards -> always out -> row can be deleted.
      assert History.compact([:in, 11], 11) == nil
    end

    test "preserves membership across folded toggles" do
      # [:out, 9, 11]: out before 9, in from 9..10, out from 11.
      # retain from 10 onwards: at time 10 value is in, flips out at 11.
      assert History.compact([:out, 9, 11], 10) == [:in, 11]

      # [:in, 9, 11]: in before 9, out from 9..10, in from 11.
      # retain from 10 onwards: at time 10 value is out, flips in at 11.
      assert History.compact([:in, 9, 11], 10) == [:out, 11]
    end

    test "returns nil when retained window is entirely out" do
      assert History.compact([:out, 9, 11], 12) == nil
      assert History.compact([:in, 5], 10) == nil
    end

    test "returns [] when retained window is entirely in" do
      # [:out, 9, 11, 20]: out, in at 9, out at 11, in at 20.
      # retain from 20 onwards -> always in.
      assert History.compact([:out, 9, 11, 20], 20) == []
    end
  end
end
