defmodule Electric.Satellite.Auth.InsecureTest do
  use ExUnit.Case, async: true

  import Electric.Satellite.Auth.Insecure, only: [validate_token: 2]
  alias Electric.Satellite.Auth

  @namespace "https://electric-sql.com/jwt/claims"

  describe "unsigned validate_token()" do
    test "successfully validates a token that has no signature" do
      claims = %{
        "iat" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "nbf" => DateTime.to_unix(~U[2023-05-01 00:00:00Z]),
        "exp" => DateTime.to_unix(~U[2123-05-01 00:00:00Z]),
        @namespace => %{"user_id" => "12345"}
      }

      token = unsigned_token(claims)

      assert {:ok, %Auth{user_id: "12345"}} ==
               validate_token(token, config(namespace: @namespace))

      ###

      claims = %{"user_id" => "0"}
      token = unsigned_token(claims)
      assert {:ok, %Auth{user_id: "0"}} == validate_token(token, config([]))
    end

    defp unsigned_token(claims) do
      # With yajwt it was possible to simply call
      #
      #     JWT.sign(claims, %{alg: "none"})
      #
      # But Joken does not support the "none" signing algorithm. Hence the manual encoding.
      header = encode_part(%{typ: "JWT", alg: "none"})
      payload = encode_part(claims)
      header <> "." <> payload <> "."
    end

    defp encode_part(map) do
      map
      |> Jason.encode!()
      |> Base.url_encode64(padding: false)
    end
  end

  defp config(opts) do
    Auth.Insecure.build_config(opts)
  end
end
