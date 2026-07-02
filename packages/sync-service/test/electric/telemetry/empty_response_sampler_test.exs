defmodule Electric.Telemetry.EmptyResponseSamplerTest do
  use ExUnit.Case, async: true

  alias Electric.Telemetry.EmptyResponseSampler

  describe "sample_rate/4 with the drop enabled" do
    test "empty 2xx responses are dropped (SampleRate = 0)" do
      assert 0 = EmptyResponseSampler.sample_rate(200, true, false, true)
    end

    test "error responses (>= 500) are kept and stamped with SampleRate = 1, even when empty" do
      assert 1 = EmptyResponseSampler.sample_rate(500, true, false, true)
      assert 1 = EmptyResponseSampler.sample_rate(503, false, false, true)
    end

    test "SSE empty responses are left unchanged (never dropped)" do
      assert :unchanged = EmptyResponseSampler.sample_rate(200, true, true, true)
    end

    test "non-empty 2xx responses are left unchanged" do
      assert :unchanged = EmptyResponseSampler.sample_rate(200, false, false, true)
    end
  end

  describe "sample_rate/4 with the drop disabled" do
    test "empty 2xx responses are left unchanged (not dropped)" do
      assert :unchanged = EmptyResponseSampler.sample_rate(200, true, false, false)
    end

    test "error responses are still kept with SampleRate = 1 (checked before the toggle)" do
      assert 1 = EmptyResponseSampler.sample_rate(500, true, false, false)
    end
  end
end
