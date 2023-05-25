defmodule Electric.Postgres.Case do
  defmacro __using__(opts) do
    quote do
      use ExUnit.Case, unquote(opts)

      alias Electric.{Postgres, Postgres.Schema, Postgres.Schema.Proto}
      alias Electric.Postgres.SQLGenerator

      def esc(str) do
        String.replace(str, "'", "''")
      end

      def parse(sql) do
        Electric.Postgres.parse!(sql)
      end

      def assert_valid_schema(schema) do
        assert {:ok, bin} = Proto.Schema.encode(schema)
        assert {:ok, schema2} = Proto.Schema.decode(IO.iodata_to_binary(bin))
        assert schema == schema2

        assert {:ok, bin} = Proto.Schema.json_encode(schema)
        assert {:ok, schema2} = Proto.Schema.json_decode(IO.iodata_to_binary(bin))
        assert schema == schema2
      end
    end
  end
end
