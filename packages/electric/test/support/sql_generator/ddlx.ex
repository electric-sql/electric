defmodule Electric.Postgres.SQLGenerator.DDLX do
  use Electric.Postgres.SQLGenerator
  alias __MODULE__

  def unquoted_name() do
    StreamData.tuple(
      {StreamData.constant(false), StreamData.string(Enum.concat([?a..?z, [?_]]), min_length: 3)}
    )
  end

  def quoted_name() do
    StreamData.tuple(
      # {true, StreamData.string(Enum.concat([[:printable], [?", ?_, ?-]]), min_length: 3)}
      {
        true,
        # throw out utf8 but ensure that we're including double quotes etc
        # because those are the awkward ones
        StreamData.list_of(
          StreamData.one_of([
            # StreamData.codepoint(:printable),
            # StreamData.member_of(Enum.concat([?a..?z, ?A..?Z, [?\s, ?_, ?", ?', ?-]]))
            StreamData.member_of(Enum.concat([?a..?z, ?A..?Z]))
          ]),
          min_length: 3
        )
        |> StreamData.map(&to_string/1)
      }
    )
  end

  def quoted_or_unquoted_name() do
    StreamData.one_of([unquoted_name(), quoted_name()])
  end

  def table_name() do
    StreamData.one_of([
      StreamData.tuple({quoted_or_unquoted_name(), quoted_or_unquoted_name()}),
      quoted_or_unquoted_name()
    ])
  end

  def table do
    table_name() |> Enum.take(1) |> hd
  end

  def column_list do
    StreamData.one_of([
      StreamData.constant(nil),
      StreamData.list_of(quoted_or_unquoted_name(), min_length: 1)
    ])
  end

  def enable(opts \\ []) do
    table_name =
      Keyword.get_lazy(opts, :table, &table/0)

    stmt(
      [
        # list_of(member_of(whitespace())),
        "ALTER",
        "TABLE",
        quote_name(table_name),
        "ENABLE",
        "ELECTRIC",
        optional(";")
      ],
      whitespace()
    )
  end

  def using do
    StreamData.one_of([
      StreamData.constant(nil),
      # TODO: think this needs to also have the column_name/column_name syntax
      quoted_or_unquoted_name()
    ])
  end

  def grant(opts \\ []) do
    _column_names = Keyword.get_lazy(opts, :columns, &column_list/0)
    _using = Keyword.get_lazy(opts, :using, &using/0)

    # TODO: check clause CHECK (column = 'contstant', other_column = 3) etc
    _table_name =
      Keyword.get_lazy(opts, :table, &table/0)
  end

  defmodule Assign do
    import StreamData

    def scope do
      one_of([
        constant(nil),
        DDLX.unquoted_name()
      ])
    end

    def role do
      one_of([
        DDLX.unquoted_name(),
        tuple({DDLX.quoted_or_unquoted_name(), DDLX.quoted_or_unquoted_name()})
        # |> map(fn {table, column} -> "#{quote_name(table)}.#{quote_name(column)}" end)
      ])
    end

    def scope_user_role do
      bind(
        tuple(
          {one_of([
             tuple({DDLX.quoted_or_unquoted_name(), DDLX.quoted_or_unquoted_name()}),
             DDLX.quoted_or_unquoted_name()
           ]), DDLX.quoted_or_unquoted_name()}
        ),
        fn {table, user_column} ->
          # scope , table, user_id column, role_column
          tuple({
            scope(),
            tuple({constant(table), constant(user_column)}),
            one_of([
              DDLX.unquoted_name(),
              tuple({constant(table), DDLX.quoted_or_unquoted_name()})
            ])
          })
        end
      )
    end

    def column do
      DDLX.quoted_or_unquoted_name()
    end

    def generator(opts \\ []) do
      scope_user_role =
        opts
        |> Keyword.get_lazy(:scope_user_role, &scope_user_role/0)
        |> case do
          t when is_tuple(t) -> constant(t)
          generator -> generator
        end

      bind(scope_user_role, fn {scope, user_def, role_def} ->
        stmt([
          "ELECTRIC",
          "ASSIGN",
          quote_scope_role(scope, role_def),
          "TO",
          quote_name(user_def)
        ])
      end)
    end

    defp quote_scope(nil), do: "NULL"
    defp quote_scope(r), do: quote_name(r)

    defp quote_scope_role(scope, role_def) do
      bind(member_of([:colon, :paren]), fn style ->
        case {style, role_def} do
          {:colon, {{_, _}, {_, _}} = role} ->
            constant("#{quote_scope(scope)}:#{quote_role(role)}")

          {:colon, {false, _} = role} ->
            constant("#{quote_scope(scope)}:#{quote_role(role)}")

          {:paren, role} ->
            constant("(#{quote_scope(scope)}, #{quote_role(role)})")
        end
      end)
    end

    defp quote_role({{_, _}, {_, _}} = role) do
      quote_name(role)
    end

    defp quote_role({false, role}) when is_binary(role) do
      "'#{role}'"
    end
  end
end
