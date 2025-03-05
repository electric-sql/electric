defmodule Electric.ConfigTest do
  use ExUnit.Case, async: true

  doctest Electric.Config, import: true

  describe "validate_security_config!/2" do
    test "raises error when neither secret nor insecure mode are set" do
      assert_raise RuntimeError, ~r/Must set ELECTRIC_SECRET unless ELECTRIC_INSECURE=true/, fn ->
        Electric.Config.validate_security_config!(nil, false)
      end
    end

    test "raises error when both secret and insecure mode are set" do
      assert_raise RuntimeError,
                   ~r/Cannot set both ELECTRIC_SECRET and ELECTRIC_INSECURE=true/,
                   fn ->
                     Electric.Config.validate_security_config!("secret", true)
                   end
    end

    test "accepts valid secure configuration" do
      assert :ok = Electric.Config.validate_security_config!("secret", false)
    end

    test "accepts valid insecure configuration" do
      assert :ok = Electric.Config.validate_security_config!(nil, true)
    end
  end
end
