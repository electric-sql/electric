defmodule Electric.DDLX.Parse.Common do
  alias Electric.Postgres.NameParser

  @doc """
    uses this to template a compiled regex into each parser with the common bits from below and their own keywords
  """
  defmacro __using__(_) do
    quote do
      @token_re regex_for_keywords(@keywords)
      @default_schema "public"

      def token_regex() do
        @token_re
      end

      def elements() do
        @elements
      end
    end
  end

  def scope_and_role(role_name) do
    if String.contains?(role_name, ":") do
      String.split(role_name, ":")
      |> List.to_tuple()
    else
      {"__global__", role_name}
    end
  end

  def schema_and_table(table_name, default_schema) do
    NameParser.parse!(table_name, default_schema: default_schema)
  end

  def expand_privileges(privilege_name) do
    case privilege_name do
      "all" -> ["select", "update", "insert", "delete"]
      "read" -> ["select"]
      "write" -> ["update", "insert", "delete"]
      _ -> [privilege_name]
    end
  end

  def regex_for_keywords(keywords) do
    value_types = [
      ~S"\((?<collection>.+)\)",
      ~S"'(?<string>[^']+)'",
      ~S"(?<name>[\p{L}_0-9\$.\/🚀]+)\W"
    ]

    values_captures = Enum.join(value_types, "|")
    keyword_captures = Enum.join(keywords, "|")
    regexstring = "(?i)(?<keyword>#{keyword_captures})|#{values_captures}"
    Regex.compile!(regexstring, "u")
  end

  def get_value(values, value_name) do
    get_in(values, [value_name, Access.elem(1)]) |> maybe_trim()
  end

  def get_value_type(values, value_name) do
    get_in(values, [value_name, Access.elem(0)])
  end

  defp parse_collection_role_def(role_def, assign_table) do
    if String.contains?(role_def, ",") do
      parts = String.split(role_def, ",")

      scope =
        Enum.at(parts, 0)
        |> String.trim()

      scope =
        if scope == "NULL" do
          nil
        else
          scope
        end

      second =
        Enum.at(parts, 1)
        |> String.trim()

      if String.at(second, 0) == "'" and String.at(second, -1) == "'" do
        # return scope and name
        {:ok, scope, String.slice(second, 1..-2), nil}
      else
        if String.contains?(second, ".") do
          parts = String.split(second, ".")

          if Enum.at(parts, 0) == assign_table do
            # return a scope and a column
            {:ok, scope, nil, Enum.at(parts, 1)}
          else
            {:error, "The role column must be in the same table as the user column."}
          end
        else
          {
            :error,
            "If you want to specify a column to read the role from it must be in the same table as the user column."
          }
        end
      end
    else
      {
        :error,
        "You must give both a scope and either the role name or the column definiation inside the brackets seperated by a comma."
      }
    end
  end

  def parse_string_role_def(role_def) do
    if String.contains?(role_def, ":") do
      parts = String.split(role_def, ":")
      # returns a scope and a name
      {:ok, Enum.at(parts, 0), Enum.at(parts, 1), nil}
    else
      # returns only a name
      {:ok, nil, role_def, nil}
    end
  end

  def parse_name_role_def(role_def, assign_table) do
    if String.contains?(role_def, ".") do
      parts = String.split(role_def, ".")

      if Enum.at(parts, 0) == assign_table do
        # returns only a column
        {:ok, nil, nil, Enum.at(parts, 1)}
      else
        {:error, "The role column must be in the same table as the user column."}
      end
    else
      {:error, "You must specify the table and column name for ASSIGN seperated by a dot"}
    end
  end

  def parse_role_def(role_def, role_def_type, table_name) do
    case role_def_type do
      :collection ->
        parse_collection_role_def(role_def, table_name)

      :string ->
        parse_string_role_def(role_def)

      :name ->
        parse_name_role_def(role_def, table_name)
    end
  end

  def parse_to_def(to_def, default_schema) do
    if String.contains?(to_def, ".") do
      parts = String.split(to_def, ".")

      case length(parts) do
        2 ->
          {:ok, default_schema, Enum.at(parts, 0), Enum.at(parts, 1)}

        3 ->
          {:ok, Enum.at(parts, 0), Enum.at(parts, 1), Enum.at(parts, 2)}

        _ ->
          {:error, "Too many dots in the user column definition."}
      end
    else
      {:error, "You must specify the table and column name for TO seperated by a dot"}
    end
  end

  defp maybe_trim(nil), do: nil
  defp maybe_trim(str), do: String.trim(str)
end
