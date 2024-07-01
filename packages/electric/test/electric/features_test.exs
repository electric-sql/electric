defmodule Electric.FeaturesTest do
  use ExUnit.Case, async: true

  alias Electric.Features

  def start_feature_instance(cxt) do
    name = __MODULE__.Features

    start_supervised(
      {Features,
       flags: %{enabled_feature: true, disabled_feature: false},
       name: name,
       default: Map.get(cxt, :default, false)}
    )

    {:ok, name: name}
  end

  describe "parse_flags/1" do
    test "returns empty map for empty string" do
      assert %{} = Features.parse_flags!("")
    end

    test "gets flags from colon separated string" do
      assert %{some_flag: true, other_flag: false} =
               Features.parse_flags!("some_flag=true:other_flag=false:")
    end

    test "values from start of string get precedence" do
      assert %{some_flag: true, other_flag: false} =
               Features.parse_flags!("some_flag=true:other_flag=false:some_flag=false")
    end
  end

  describe "initialisation" do
    test "reads values from application configuration" do
      name = __MODULE__.Features

      try do
        Application.put_env(:electric, name, enabled_feature: true, disabled_feature: false)

        start_supervised({Features, name: name})

        assert Features.enabled?(:enabled_feature, name)
        refute Features.enabled?(:disabled_feature, name)
      after
        Application.delete_env(:electric, name)
      end
    end

    test "reads values from env" do
      var_name = "TEST_FLAGS"
      name = __MODULE__.Features

      try do
        System.put_env(var_name, "enabled_feature=true:disabled_feature=false:")
        start_supervised({Features, env_var: var_name, name: name})

        assert Features.enabled?(:enabled_feature, name)
        refute Features.enabled?(:disabled_feature, name)
      after
        System.delete_env(var_name)
      end
    end

    test "environment settings have precedence over application" do
      var_name = "TEST_FLAGS"
      name = __MODULE__.Features

      try do
        Application.put_env(:electric, name, enabled_feature: false, disabled_feature: true)
        System.put_env(var_name, "enabled_feature=true:disabled_feature=false:")

        start_supervised({Features, env_var: var_name, name: name})

        assert Features.enabled?(:enabled_feature, name)
        refute Features.enabled?(:disabled_feature, name)
      after
        Application.delete_env(:electric, name)
        System.delete_env(var_name)
      end
    end
  end

  describe "enabled?/2 default: false" do
    setup [:start_feature_instance]

    test "reads values from env", cxt do
      assert Features.enabled?(:enabled_feature, cxt.name)
    end

    test "defaults to false for unset flags", cxt do
      refute Features.enabled?(:unknown_feature, cxt.name)
    end
  end

  describe "enabled?/2 default: true" do
    setup do
      {:ok, default: true}
    end

    setup [:start_feature_instance]

    test "reads values from env", cxt do
      assert Features.enabled?(:enabled_feature, cxt.name)
      refute Features.enabled?(:disabled_feature, cxt.name)
    end

    test "defaults to true for unset flags", cxt do
      assert Features.enabled?(:unknown_feature, cxt.name)
      refute Features.enabled?(:disabled_feature, cxt.name)
    end
  end

  describe "process_override/2" do
    setup [:start_feature_instance]

    test "allows for setting feature flags on the current process", cxt do
      assert Features.enabled?(:enabled_feature, cxt.name)
      refute Features.enabled?(:disabled_feature, cxt.name)

      Features.process_override([disabled_feature: true, enabled_feature: false], cxt.name)

      refute Features.enabled?(:enabled_feature, cxt.name)
      assert Features.enabled?(:disabled_feature, cxt.name)

      Features.process_reset(cxt.name)

      assert Features.enabled?(:enabled_feature, cxt.name)
      refute Features.enabled?(:disabled_feature, cxt.name)
    end
  end

  describe "enable/2" do
    setup [:start_feature_instance]

    test "allows for globally setting a flag", cxt do
      assert Features.enabled?(:enabled_feature, cxt.name)
      refute Features.enabled?(:disabled_feature, cxt.name)

      Features.enable([enabled_feature: false, disabled_feature: true], cxt.name)

      refute Features.enabled?(:enabled_feature, cxt.name)
      assert Features.enabled?(:disabled_feature, cxt.name)
    end
  end
end
