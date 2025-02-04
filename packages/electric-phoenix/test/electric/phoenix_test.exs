defmodule Electric.PhoenixTest do
  use ExUnit.Case, async: true
  use Plug.Test

  doctest Electric.Phoenix

  describe "shape_from_params/[1,2]" do
    alias Electric.Client.ShapeDefinition

    test "returns a ShapeDefinition based on the request query params" do
      conn =
        conn(:get, "/my/path", %{
          "table" => "items",
          "namespace" => "my_app",
          "where" => "something = 'open'",
          "columns" => "id,name,value"
        })

      assert {:ok,
              %ShapeDefinition{
                table: "items",
                namespace: "my_app",
                where: "something = 'open'",
                columns: ["id", "name", "value"]
              }} = Electric.Phoenix.shape_from_params(conn)

      conn = conn(:get, "/my/path", %{"table" => "items"})

      assert {:ok,
              %ShapeDefinition{
                table: "items",
                namespace: nil,
                where: nil,
                columns: nil
              }} = Electric.Phoenix.shape_from_params(conn)

      conn = conn(:get, "/my/path", %{"where" => "true"})

      assert {:error, _} = Electric.Phoenix.shape_from_params(conn)

      conn =
        conn(:get, "/my/path", %{"table" => "items", "columns" => nil})

      assert {:ok, %ShapeDefinition{table: "items", columns: nil}} =
               Electric.Phoenix.shape_from_params(conn)
    end

    test "accepts a parameter map" do
      assert {:ok, %ShapeDefinition{table: "items"}} =
               Electric.Phoenix.shape_from_params(%{
                 "table" => "items",
                 "columns" => nil,
                 "where" => nil
               })

      assert {:error, _} = Electric.Phoenix.shape_from_params(%{})

      assert {:ok, %ShapeDefinition{table: "items"}} =
               Electric.Phoenix.shape_from_params(%{},
                 table: "items"
               )
    end

    test "allows for overriding specific attributes" do
      conn =
        conn(:get, "/my/path", %{
          "table" => "ignored",
          "namespace" => "ignored_as_well",
          "columns" => "ignored,also",
          "where" => "something = 'open'"
        })

      assert {:ok,
              %ShapeDefinition{
                table: "items",
                namespace: "my_app",
                where: "something = 'open'",
                columns: ["id", "name", "value"]
              }} =
               Electric.Phoenix.shape_from_params(conn,
                 table: "items",
                 namespace: "my_app",
                 columns: ["id", "name", "value"]
               )

      conn = conn(:get, "/my/path", %{"where" => "something = 'open'"})

      assert {:ok,
              %ShapeDefinition{
                table: "items",
                namespace: "my_app",
                where: "something = 'open'",
                columns: ["id", "name", "value"]
              }} =
               Electric.Phoenix.shape_from_params(conn,
                 table: "items",
                 namespace: "my_app",
                 columns: ["id", "name", "value"]
               )
    end
  end
end
