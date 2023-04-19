# credo:disable-for-this-file
[
  defmodule Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :NO_ACTION
        def default() do
          :NO_ACTION
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:NO_ACTION) do
            0
          end

          def encode("NO_ACTION") do
            0
          end
        ),
        (
          def encode(:RESTRICT) do
            1
          end

          def encode("RESTRICT") do
            1
          end
        ),
        (
          def encode(:CASCADE) do
            2
          end

          def encode("CASCADE") do
            2
          end
        ),
        (
          def encode(:SET_NULL) do
            3
          end

          def encode("SET_NULL") do
            3
          end
        ),
        (
          def encode(:SET_DEFAULT) do
            4
          end

          def encode("SET_DEFAULT") do
            4
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :NO_ACTION
        end,
        def decode(1) do
          :RESTRICT
        end,
        def decode(2) do
          :CASCADE
        end,
        def decode(3) do
          :SET_NULL
        end,
        def decode(4) do
          :SET_DEFAULT
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :NO_ACTION}, {1, :RESTRICT}, {2, :CASCADE}, {3, :SET_NULL}, {4, :SET_DEFAULT}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:NO_ACTION) do
            true
          end,
          def has_constant?(:RESTRICT) do
            true
          end,
          def has_constant?(:CASCADE) do
            true
          end,
          def has_constant?(:SET_NULL) do
            true
          end,
          def has_constant?(:SET_DEFAULT) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :SIMPLE
        def default() do
          :SIMPLE
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:SIMPLE) do
            0
          end

          def encode("SIMPLE") do
            0
          end
        ),
        (
          def encode(:FULL) do
            1
          end

          def encode("FULL") do
            1
          end
        ),
        (
          def encode(:PARTIAL) do
            2
          end

          def encode("PARTIAL") do
            2
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :SIMPLE
        end,
        def decode(1) do
          :FULL
        end,
        def decode(2) do
          :PARTIAL
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :SIMPLE}, {1, :FULL}, {2, :PARTIAL}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:SIMPLE) do
            true
          end,
          def has_constant?(:FULL) do
            true
          end,
          def has_constant?(:PARTIAL) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.Generated.When do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :ALWAYS
        def default() do
          :ALWAYS
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:ALWAYS) do
            0
          end

          def encode("ALWAYS") do
            0
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :ALWAYS
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :ALWAYS}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:ALWAYS) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.BoolExpr.Op do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :AND
        def default() do
          :AND
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:AND) do
            0
          end

          def encode("AND") do
            0
          end
        ),
        (
          def encode(:OR) do
            1
          end

          def encode("OR") do
            1
          end
        ),
        (
          def encode(:NOT) do
            2
          end

          def encode("NOT") do
            2
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :AND
        end,
        def decode(1) do
          :OR
        end,
        def decode(2) do
          :NOT
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :AND}, {1, :OR}, {2, :NOT}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:AND) do
            true
          end,
          def has_constant?(:OR) do
            true
          end,
          def has_constant?(:NOT) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.NullTest.TestType do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :IS
        def default() do
          :IS
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:IS) do
            0
          end

          def encode("IS") do
            0
          end
        ),
        (
          def encode(:IS_NOT) do
            1
          end

          def encode("IS_NOT") do
            1
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :IS
        end,
        def decode(1) do
          :IS_NOT
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :IS}, {1, :IS_NOT}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:IS) do
            true
          end,
          def has_constant?(:IS_NOT) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.Value.Type do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :STRING
        def default() do
          :STRING
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:STRING) do
            0
          end

          def encode("STRING") do
            0
          end
        ),
        (
          def encode(:INTEGER) do
            1
          end

          def encode("INTEGER") do
            1
          end
        ),
        (
          def encode(:FLOAT) do
            2
          end

          def encode("FLOAT") do
            2
          end
        ),
        (
          def encode(:BOOLEAN) do
            3
          end

          def encode("BOOLEAN") do
            3
          end
        ),
        (
          def encode(:BITSTRING) do
            4
          end

          def encode("BITSTRING") do
            4
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :STRING
        end,
        def decode(1) do
          :INTEGER
        end,
        def decode(2) do
          :FLOAT
        end,
        def decode(3) do
          :BOOLEAN
        end,
        def decode(4) do
          :BITSTRING
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :STRING}, {1, :INTEGER}, {2, :FLOAT}, {3, :BOOLEAN}, {4, :BITSTRING}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:STRING) do
            true
          end,
          def has_constant?(:INTEGER) do
            true
          end,
          def has_constant?(:FLOAT) do
            true
          end,
          def has_constant?(:BOOLEAN) do
            true
          end,
          def has_constant?(:BITSTRING) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Index.NullsOrdering do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :LAST
        def default() do
          :LAST
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:LAST) do
            0
          end

          def encode("LAST") do
            0
          end
        ),
        (
          def encode(:FIRST) do
            1
          end

          def encode("FIRST") do
            1
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :LAST
        end,
        def decode(1) do
          :FIRST
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :LAST}, {1, :FIRST}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:LAST) do
            true
          end,
          def has_constant?(:FIRST) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Index.Ordering do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :ASC
        def default() do
          :ASC
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:ASC) do
            0
          end

          def encode("ASC") do
            0
          end
        ),
        (
          def encode(:DESC) do
            2
          end

          def encode("DESC") do
            2
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :ASC
        end,
        def decode(2) do
          :DESC
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :ASC}, {2, :DESC}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:ASC) do
            true
          end,
          def has_constant?(:DESC) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Column do
    @moduledoc false
    defstruct name: "", type: nil, constraints: []

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_name(msg) |> encode_type(msg) |> encode_constraints(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_type(acc, msg) do
          try do
            if msg.type == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.type)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:type, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_constraints(acc, msg) do
          try do
            case msg.constraints do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x1A", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:constraints, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Column))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   type:
                     Protox.MergeMessage.merge(
                       msg.type,
                       Electric.Postgres.Schema.Proto.Column.Type.decode!(delimited)
                     )
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   constraints:
                     msg.constraints ++
                       [Electric.Postgres.Schema.Proto.Constraint.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Column,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:type, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Column.Type}},
          3 => {:constraints, :unpacked, {:message, Electric.Postgres.Schema.Proto.Constraint}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          constraints: {3, :unpacked, {:message, Electric.Postgres.Schema.Proto.Constraint}},
          name: {1, {:scalar, ""}, :string},
          type: {2, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Column.Type}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "type",
            kind: {:scalar, nil},
            label: :optional,
            name: :type,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Column.Type}
          },
          %{
            __struct__: Protox.Field,
            json_name: "constraints",
            kind: :unpacked,
            label: :repeated,
            name: :constraints,
            tag: 3,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, nil},
               label: :optional,
               name: :type,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Column.Type}
             }}
          end

          def field_def("type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, nil},
               label: :optional,
               name: :type,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Column.Type}
             }}
          end

          []
        ),
        (
          def field_def(:constraints) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "constraints",
               kind: :unpacked,
               label: :repeated,
               name: :constraints,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint}
             }}
          end

          def field_def("constraints") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "constraints",
               kind: :unpacked,
               label: :repeated,
               name: :constraints,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:type) do
        {:ok, nil}
      end,
      def default(:constraints) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Column.Type do
    @moduledoc false
    defstruct name: "", size: [], array: []

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_name(msg) |> encode_size(msg) |> encode_array(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_size(acc, msg) do
          try do
            case msg.size do
              [] ->
                acc

              values ->
                [
                  acc,
                  "\x12",
                  (
                    {bytes, len} =
                      Enum.reduce(values, {[], 0}, fn value, {acc, len} ->
                        value_bytes = :binary.list_to_bin([Protox.Encode.encode_int32(value)])
                        {[acc, value_bytes], len + byte_size(value_bytes)}
                      end)

                    [Protox.Varint.encode(len), bytes]
                  )
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:size, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_array(acc, msg) do
          try do
            case msg.array do
              [] ->
                acc

              values ->
                [
                  acc,
                  "\x1A",
                  (
                    {bytes, len} =
                      Enum.reduce(values, {[], 0}, fn value, {acc, len} ->
                        value_bytes = :binary.list_to_bin([Protox.Encode.encode_int32(value)])
                        {[acc, value_bytes], len + byte_size(value_bytes)}
                      end)

                    [Protox.Varint.encode(len), bytes]
                  )
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:array, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Column.Type))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, 2, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[size: msg.size ++ Protox.Decode.parse_repeated_int32([], delimited)], rest}

              {2, _, bytes} ->
                {value, rest} = Protox.Decode.parse_int32(bytes)
                {[size: msg.size ++ [value]], rest}

              {3, 2, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[array: msg.array ++ Protox.Decode.parse_repeated_int32([], delimited)], rest}

              {3, _, bytes} ->
                {value, rest} = Protox.Decode.parse_int32(bytes)
                {[array: msg.array ++ [value]], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Column.Type,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:size, :packed, :int32},
          3 => {:array, :packed, :int32}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          array: {3, :packed, :int32},
          name: {1, {:scalar, ""}, :string},
          size: {2, :packed, :int32}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "size",
            kind: :packed,
            label: :repeated,
            name: :size,
            tag: 2,
            type: :int32
          },
          %{
            __struct__: Protox.Field,
            json_name: "array",
            kind: :packed,
            label: :repeated,
            name: :array,
            tag: 3,
            type: :int32
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:size) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "size",
               kind: :packed,
               label: :repeated,
               name: :size,
               tag: 2,
               type: :int32
             }}
          end

          def field_def("size") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "size",
               kind: :packed,
               label: :repeated,
               name: :size,
               tag: 2,
               type: :int32
             }}
          end

          []
        ),
        (
          def field_def(:array) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "array",
               kind: :packed,
               label: :repeated,
               name: :array,
               tag: 3,
               type: :int32
             }}
          end

          def field_def("array") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "array",
               kind: :packed,
               label: :repeated,
               name: :array,
               tag: 3,
               type: :int32
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:size) do
        {:error, :no_default_value}
      end,
      def default(:array) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint do
    @moduledoc false
    defstruct constraint: nil

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_constraint(msg)
        end
      )

      [
        defp encode_constraint(acc, msg) do
          case msg.constraint do
            nil -> acc
            {:not_null, _field_value} -> encode_not_null(acc, msg)
            {:primary, _field_value} -> encode_primary(acc, msg)
            {:foreign, _field_value} -> encode_foreign(acc, msg)
            {:unique, _field_value} -> encode_unique(acc, msg)
            {:check, _field_value} -> encode_check(acc, msg)
            {:generated, _field_value} -> encode_generated(acc, msg)
            {:default, _field_value} -> encode_default(acc, msg)
          end
        end
      ]

      [
        defp encode_not_null(acc, msg) do
          try do
            {_, child_field_value} = msg.constraint
            [acc, "\n", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:not_null, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_primary(acc, msg) do
          try do
            {_, child_field_value} = msg.constraint
            [acc, "\x12", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:primary, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_foreign(acc, msg) do
          try do
            {_, child_field_value} = msg.constraint
            [acc, "\x1A", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:foreign, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_unique(acc, msg) do
          try do
            {_, child_field_value} = msg.constraint
            [acc, "\"", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:unique, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_check(acc, msg) do
          try do
            {_, child_field_value} = msg.constraint
            [acc, "*", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:check, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_generated(acc, msg) do
          try do
            {_, child_field_value} = msg.constraint
            [acc, "2", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:generated, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_default(acc, msg) do
          try do
            {_, child_field_value} = msg.constraint
            [acc, ":", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:default, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Constraint))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.constraint do
                     {:not_null, previous_value} ->
                       {:constraint,
                        {:not_null,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Constraint.NotNull.decode!(delimited)
                         )}}

                     _ ->
                       {:constraint,
                        {:not_null,
                         Electric.Postgres.Schema.Proto.Constraint.NotNull.decode!(delimited)}}
                   end
                 ], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.constraint do
                     {:primary, previous_value} ->
                       {:constraint,
                        {:primary,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Constraint.PrimaryKey.decode!(delimited)
                         )}}

                     _ ->
                       {:constraint,
                        {:primary,
                         Electric.Postgres.Schema.Proto.Constraint.PrimaryKey.decode!(delimited)}}
                   end
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.constraint do
                     {:foreign, previous_value} ->
                       {:constraint,
                        {:foreign,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Constraint.ForeignKey.decode!(delimited)
                         )}}

                     _ ->
                       {:constraint,
                        {:foreign,
                         Electric.Postgres.Schema.Proto.Constraint.ForeignKey.decode!(delimited)}}
                   end
                 ], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.constraint do
                     {:unique, previous_value} ->
                       {:constraint,
                        {:unique,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Constraint.Unique.decode!(delimited)
                         )}}

                     _ ->
                       {:constraint,
                        {:unique,
                         Electric.Postgres.Schema.Proto.Constraint.Unique.decode!(delimited)}}
                   end
                 ], rest}

              {5, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.constraint do
                     {:check, previous_value} ->
                       {:constraint,
                        {:check,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Constraint.Check.decode!(delimited)
                         )}}

                     _ ->
                       {:constraint,
                        {:check,
                         Electric.Postgres.Schema.Proto.Constraint.Check.decode!(delimited)}}
                   end
                 ], rest}

              {6, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.constraint do
                     {:generated, previous_value} ->
                       {:constraint,
                        {:generated,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Constraint.Generated.decode!(delimited)
                         )}}

                     _ ->
                       {:constraint,
                        {:generated,
                         Electric.Postgres.Schema.Proto.Constraint.Generated.decode!(delimited)}}
                   end
                 ], rest}

              {7, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.constraint do
                     {:default, previous_value} ->
                       {:constraint,
                        {:default,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Constraint.Default.decode!(delimited)
                         )}}

                     _ ->
                       {:constraint,
                        {:default,
                         Electric.Postgres.Schema.Proto.Constraint.Default.decode!(delimited)}}
                   end
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Constraint,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 =>
            {:not_null, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.NotNull}},
          2 =>
            {:primary, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.PrimaryKey}},
          3 =>
            {:foreign, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.ForeignKey}},
          4 =>
            {:unique, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.Unique}},
          5 =>
            {:check, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.Check}},
          6 =>
            {:generated, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.Generated}},
          7 =>
            {:default, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.Default}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          check:
            {5, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.Check}},
          default:
            {7, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.Default}},
          foreign:
            {3, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.ForeignKey}},
          generated:
            {6, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.Generated}},
          not_null:
            {1, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.NotNull}},
          primary:
            {2, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.PrimaryKey}},
          unique:
            {4, {:oneof, :constraint},
             {:message, Electric.Postgres.Schema.Proto.Constraint.Unique}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "notNull",
            kind: {:oneof, :constraint},
            label: :optional,
            name: :not_null,
            tag: 1,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint.NotNull}
          },
          %{
            __struct__: Protox.Field,
            json_name: "primary",
            kind: {:oneof, :constraint},
            label: :optional,
            name: :primary,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint.PrimaryKey}
          },
          %{
            __struct__: Protox.Field,
            json_name: "foreign",
            kind: {:oneof, :constraint},
            label: :optional,
            name: :foreign,
            tag: 3,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint.ForeignKey}
          },
          %{
            __struct__: Protox.Field,
            json_name: "unique",
            kind: {:oneof, :constraint},
            label: :optional,
            name: :unique,
            tag: 4,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint.Unique}
          },
          %{
            __struct__: Protox.Field,
            json_name: "check",
            kind: {:oneof, :constraint},
            label: :optional,
            name: :check,
            tag: 5,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint.Check}
          },
          %{
            __struct__: Protox.Field,
            json_name: "generated",
            kind: {:oneof, :constraint},
            label: :optional,
            name: :generated,
            tag: 6,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint.Generated}
          },
          %{
            __struct__: Protox.Field,
            json_name: "default",
            kind: {:oneof, :constraint},
            label: :optional,
            name: :default,
            tag: 7,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint.Default}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:not_null) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "notNull",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :not_null,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.NotNull}
             }}
          end

          def field_def("notNull") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "notNull",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :not_null,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.NotNull}
             }}
          end

          def field_def("not_null") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "notNull",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :not_null,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.NotNull}
             }}
          end
        ),
        (
          def field_def(:primary) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "primary",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :primary,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.PrimaryKey}
             }}
          end

          def field_def("primary") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "primary",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :primary,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.PrimaryKey}
             }}
          end

          []
        ),
        (
          def field_def(:foreign) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "foreign",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :foreign,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.ForeignKey}
             }}
          end

          def field_def("foreign") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "foreign",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :foreign,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.ForeignKey}
             }}
          end

          []
        ),
        (
          def field_def(:unique) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "unique",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :unique,
               tag: 4,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.Unique}
             }}
          end

          def field_def("unique") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "unique",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :unique,
               tag: 4,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.Unique}
             }}
          end

          []
        ),
        (
          def field_def(:check) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "check",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :check,
               tag: 5,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.Check}
             }}
          end

          def field_def("check") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "check",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :check,
               tag: 5,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.Check}
             }}
          end

          []
        ),
        (
          def field_def(:generated) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "generated",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :generated,
               tag: 6,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.Generated}
             }}
          end

          def field_def("generated") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "generated",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :generated,
               tag: 6,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.Generated}
             }}
          end

          []
        ),
        (
          def field_def(:default) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "default",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :default,
               tag: 7,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.Default}
             }}
          end

          def field_def("default") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "default",
               kind: {:oneof, :constraint},
               label: :optional,
               name: :default,
               tag: 7,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint.Default}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:not_null) do
        {:error, :no_default_value}
      end,
      def default(:primary) do
        {:error, :no_default_value}
      end,
      def default(:foreign) do
        {:error, :no_default_value}
      end,
      def default(:unique) do
        {:error, :no_default_value}
      end,
      def default(:check) do
        {:error, :no_default_value}
      end,
      def default(:generated) do
        {:error, :no_default_value}
      end,
      def default(:default) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.Check do
    @moduledoc false
    defstruct name: "", expr: nil, deferrable: false, initdeferred: false

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          []
          |> encode_name(msg)
          |> encode_expr(msg)
          |> encode_deferrable(msg)
          |> encode_initdeferred(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_expr(acc, msg) do
          try do
            if msg.expr == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.expr)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:expr, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_deferrable(acc, msg) do
          try do
            if msg.deferrable == false do
              acc
            else
              [acc, "\x18", Protox.Encode.encode_bool(msg.deferrable)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:deferrable, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_initdeferred(acc, msg) do
          try do
            if msg.initdeferred == false do
              acc
            else
              [acc, " ", Protox.Encode.encode_bool(msg.initdeferred)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:initdeferred, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Constraint.Check))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   expr:
                     Protox.MergeMessage.merge(
                       msg.expr,
                       Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                     )
                 ], rest}

              {3, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[deferrable: value], rest}

              {4, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[initdeferred: value], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Constraint.Check,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:expr, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          3 => {:deferrable, {:scalar, false}, :bool},
          4 => {:initdeferred, {:scalar, false}, :bool}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          deferrable: {3, {:scalar, false}, :bool},
          expr: {2, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          initdeferred: {4, {:scalar, false}, :bool},
          name: {1, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "expr",
            kind: {:scalar, nil},
            label: :optional,
            name: :expr,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          },
          %{
            __struct__: Protox.Field,
            json_name: "deferrable",
            kind: {:scalar, false},
            label: :optional,
            name: :deferrable,
            tag: 3,
            type: :bool
          },
          %{
            __struct__: Protox.Field,
            json_name: "initdeferred",
            kind: {:scalar, false},
            label: :optional,
            name: :initdeferred,
            tag: 4,
            type: :bool
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:expr) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "expr",
               kind: {:scalar, nil},
               label: :optional,
               name: :expr,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("expr") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "expr",
               kind: {:scalar, nil},
               label: :optional,
               name: :expr,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        (
          def field_def(:deferrable) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 3,
               type: :bool
             }}
          end

          def field_def("deferrable") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 3,
               type: :bool
             }}
          end

          []
        ),
        (
          def field_def(:initdeferred) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 4,
               type: :bool
             }}
          end

          def field_def("initdeferred") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 4,
               type: :bool
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:expr) do
        {:ok, nil}
      end,
      def default(:deferrable) do
        {:ok, false}
      end,
      def default(:initdeferred) do
        {:ok, false}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.Default do
    @moduledoc false
    defstruct expr: nil

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_expr(msg)
        end
      )

      []

      [
        defp encode_expr(acc, msg) do
          try do
            if msg.expr == nil do
              acc
            else
              [acc, "\n", Protox.Encode.encode_message(msg.expr)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:expr, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Constraint.Default))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   expr:
                     Protox.MergeMessage.merge(
                       msg.expr,
                       Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                     )
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Constraint.Default,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{1 => {:expr, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{expr: {1, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}}}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "expr",
            kind: {:scalar, nil},
            label: :optional,
            name: :expr,
            tag: 1,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:expr) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "expr",
               kind: {:scalar, nil},
               label: :optional,
               name: :expr,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("expr") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "expr",
               kind: {:scalar, nil},
               label: :optional,
               name: :expr,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:expr) do
        {:ok, nil}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.ForeignKey do
    @moduledoc false
    defstruct name: "",
              deferrable: false,
              initdeferred: false,
              on_update: :NO_ACTION,
              on_delete: :NO_ACTION,
              match_type: :SIMPLE,
              fk_cols: [],
              pk_table: nil,
              pk_cols: []

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          []
          |> encode_name(msg)
          |> encode_deferrable(msg)
          |> encode_initdeferred(msg)
          |> encode_on_update(msg)
          |> encode_on_delete(msg)
          |> encode_match_type(msg)
          |> encode_fk_cols(msg)
          |> encode_pk_table(msg)
          |> encode_pk_cols(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_deferrable(acc, msg) do
          try do
            if msg.deferrable == false do
              acc
            else
              [acc, "\x10", Protox.Encode.encode_bool(msg.deferrable)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:deferrable, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_initdeferred(acc, msg) do
          try do
            if msg.initdeferred == false do
              acc
            else
              [acc, "\x18", Protox.Encode.encode_bool(msg.initdeferred)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:initdeferred, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_on_update(acc, msg) do
          try do
            if msg.on_update == :NO_ACTION do
              acc
            else
              [
                acc,
                "(",
                msg.on_update
                |> Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:on_update, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_on_delete(acc, msg) do
          try do
            if msg.on_delete == :NO_ACTION do
              acc
            else
              [
                acc,
                "0",
                msg.on_delete
                |> Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:on_delete, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_match_type(acc, msg) do
          try do
            if msg.match_type == :SIMPLE do
              acc
            else
              [
                acc,
                "8",
                msg.match_type
                |> Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:match_type, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_fk_cols(acc, msg) do
          try do
            case msg.fk_cols do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "B", Protox.Encode.encode_string(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:fk_cols, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_pk_table(acc, msg) do
          try do
            if msg.pk_table == nil do
              acc
            else
              [acc, "J", Protox.Encode.encode_message(msg.pk_table)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:pk_table, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_pk_cols(acc, msg) do
          try do
            case msg.pk_cols do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "R", Protox.Encode.encode_string(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:pk_cols, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Constraint.ForeignKey))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[deferrable: value], rest}

              {3, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[initdeferred: value], rest}

              {5, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action
                  )

                {[on_update: value], rest}

              {6, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action
                  )

                {[on_delete: value], rest}

              {7, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType
                  )

                {[match_type: value], rest}

              {8, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[fk_cols: msg.fk_cols ++ [delimited]], rest}

              {9, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   pk_table:
                     Protox.MergeMessage.merge(
                       msg.pk_table,
                       Electric.Postgres.Schema.Proto.RangeVar.decode!(delimited)
                     )
                 ], rest}

              {10, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[pk_cols: msg.pk_cols ++ [delimited]], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Constraint.ForeignKey,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:deferrable, {:scalar, false}, :bool},
          3 => {:initdeferred, {:scalar, false}, :bool},
          5 =>
            {:on_update, {:scalar, :NO_ACTION},
             {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}},
          6 =>
            {:on_delete, {:scalar, :NO_ACTION},
             {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}},
          7 =>
            {:match_type, {:scalar, :SIMPLE},
             {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType}},
          8 => {:fk_cols, :unpacked, :string},
          9 => {:pk_table, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.RangeVar}},
          10 => {:pk_cols, :unpacked, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          deferrable: {2, {:scalar, false}, :bool},
          fk_cols: {8, :unpacked, :string},
          initdeferred: {3, {:scalar, false}, :bool},
          match_type:
            {7, {:scalar, :SIMPLE},
             {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType}},
          name: {1, {:scalar, ""}, :string},
          on_delete:
            {6, {:scalar, :NO_ACTION},
             {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}},
          on_update:
            {5, {:scalar, :NO_ACTION},
             {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}},
          pk_cols: {10, :unpacked, :string},
          pk_table: {9, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.RangeVar}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "deferrable",
            kind: {:scalar, false},
            label: :optional,
            name: :deferrable,
            tag: 2,
            type: :bool
          },
          %{
            __struct__: Protox.Field,
            json_name: "initdeferred",
            kind: {:scalar, false},
            label: :optional,
            name: :initdeferred,
            tag: 3,
            type: :bool
          },
          %{
            __struct__: Protox.Field,
            json_name: "onUpdate",
            kind: {:scalar, :NO_ACTION},
            label: :optional,
            name: :on_update,
            tag: 5,
            type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}
          },
          %{
            __struct__: Protox.Field,
            json_name: "onDelete",
            kind: {:scalar, :NO_ACTION},
            label: :optional,
            name: :on_delete,
            tag: 6,
            type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}
          },
          %{
            __struct__: Protox.Field,
            json_name: "matchType",
            kind: {:scalar, :SIMPLE},
            label: :optional,
            name: :match_type,
            tag: 7,
            type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType}
          },
          %{
            __struct__: Protox.Field,
            json_name: "fkCols",
            kind: :unpacked,
            label: :repeated,
            name: :fk_cols,
            tag: 8,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "pkTable",
            kind: {:scalar, nil},
            label: :optional,
            name: :pk_table,
            tag: 9,
            type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
          },
          %{
            __struct__: Protox.Field,
            json_name: "pkCols",
            kind: :unpacked,
            label: :repeated,
            name: :pk_cols,
            tag: 10,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:deferrable) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 2,
               type: :bool
             }}
          end

          def field_def("deferrable") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 2,
               type: :bool
             }}
          end

          []
        ),
        (
          def field_def(:initdeferred) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 3,
               type: :bool
             }}
          end

          def field_def("initdeferred") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 3,
               type: :bool
             }}
          end

          []
        ),
        (
          def field_def(:on_update) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "onUpdate",
               kind: {:scalar, :NO_ACTION},
               label: :optional,
               name: :on_update,
               tag: 5,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}
             }}
          end

          def field_def("onUpdate") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "onUpdate",
               kind: {:scalar, :NO_ACTION},
               label: :optional,
               name: :on_update,
               tag: 5,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}
             }}
          end

          def field_def("on_update") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "onUpdate",
               kind: {:scalar, :NO_ACTION},
               label: :optional,
               name: :on_update,
               tag: 5,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}
             }}
          end
        ),
        (
          def field_def(:on_delete) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "onDelete",
               kind: {:scalar, :NO_ACTION},
               label: :optional,
               name: :on_delete,
               tag: 6,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}
             }}
          end

          def field_def("onDelete") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "onDelete",
               kind: {:scalar, :NO_ACTION},
               label: :optional,
               name: :on_delete,
               tag: 6,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}
             }}
          end

          def field_def("on_delete") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "onDelete",
               kind: {:scalar, :NO_ACTION},
               label: :optional,
               name: :on_delete,
               tag: 6,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.Action}
             }}
          end
        ),
        (
          def field_def(:match_type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "matchType",
               kind: {:scalar, :SIMPLE},
               label: :optional,
               name: :match_type,
               tag: 7,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType}
             }}
          end

          def field_def("matchType") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "matchType",
               kind: {:scalar, :SIMPLE},
               label: :optional,
               name: :match_type,
               tag: 7,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType}
             }}
          end

          def field_def("match_type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "matchType",
               kind: {:scalar, :SIMPLE},
               label: :optional,
               name: :match_type,
               tag: 7,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.ForeignKey.MatchType}
             }}
          end
        ),
        (
          def field_def(:fk_cols) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "fkCols",
               kind: :unpacked,
               label: :repeated,
               name: :fk_cols,
               tag: 8,
               type: :string
             }}
          end

          def field_def("fkCols") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "fkCols",
               kind: :unpacked,
               label: :repeated,
               name: :fk_cols,
               tag: 8,
               type: :string
             }}
          end

          def field_def("fk_cols") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "fkCols",
               kind: :unpacked,
               label: :repeated,
               name: :fk_cols,
               tag: 8,
               type: :string
             }}
          end
        ),
        (
          def field_def(:pk_table) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pkTable",
               kind: {:scalar, nil},
               label: :optional,
               name: :pk_table,
               tag: 9,
               type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
             }}
          end

          def field_def("pkTable") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pkTable",
               kind: {:scalar, nil},
               label: :optional,
               name: :pk_table,
               tag: 9,
               type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
             }}
          end

          def field_def("pk_table") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pkTable",
               kind: {:scalar, nil},
               label: :optional,
               name: :pk_table,
               tag: 9,
               type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
             }}
          end
        ),
        (
          def field_def(:pk_cols) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pkCols",
               kind: :unpacked,
               label: :repeated,
               name: :pk_cols,
               tag: 10,
               type: :string
             }}
          end

          def field_def("pkCols") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pkCols",
               kind: :unpacked,
               label: :repeated,
               name: :pk_cols,
               tag: 10,
               type: :string
             }}
          end

          def field_def("pk_cols") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pkCols",
               kind: :unpacked,
               label: :repeated,
               name: :pk_cols,
               tag: 10,
               type: :string
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:deferrable) do
        {:ok, false}
      end,
      def default(:initdeferred) do
        {:ok, false}
      end,
      def default(:on_update) do
        {:ok, :NO_ACTION}
      end,
      def default(:on_delete) do
        {:ok, :NO_ACTION}
      end,
      def default(:match_type) do
        {:ok, :SIMPLE}
      end,
      def default(:fk_cols) do
        {:error, :no_default_value}
      end,
      def default(:pk_table) do
        {:ok, nil}
      end,
      def default(:pk_cols) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.Generated do
    @moduledoc false
    defstruct name: "", when: :ALWAYS, expr: nil

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_name(msg) |> encode_when(msg) |> encode_expr(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_when(acc, msg) do
          try do
            if msg.when == :ALWAYS do
              acc
            else
              [
                acc,
                "\x10",
                msg.when
                |> Electric.Postgres.Schema.Proto.Constraint.Generated.When.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:when, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_expr(acc, msg) do
          try do
            if msg.expr == nil do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_message(msg.expr)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:expr, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Constraint.Generated))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Postgres.Schema.Proto.Constraint.Generated.When
                  )

                {[when: value], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   expr:
                     Protox.MergeMessage.merge(
                       msg.expr,
                       Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                     )
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Constraint.Generated,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 =>
            {:when, {:scalar, :ALWAYS},
             {:enum, Electric.Postgres.Schema.Proto.Constraint.Generated.When}},
          3 => {:expr, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          expr: {3, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          name: {1, {:scalar, ""}, :string},
          when:
            {2, {:scalar, :ALWAYS},
             {:enum, Electric.Postgres.Schema.Proto.Constraint.Generated.When}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "when",
            kind: {:scalar, :ALWAYS},
            label: :optional,
            name: :when,
            tag: 2,
            type: {:enum, Electric.Postgres.Schema.Proto.Constraint.Generated.When}
          },
          %{
            __struct__: Protox.Field,
            json_name: "expr",
            kind: {:scalar, nil},
            label: :optional,
            name: :expr,
            tag: 3,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:when) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "when",
               kind: {:scalar, :ALWAYS},
               label: :optional,
               name: :when,
               tag: 2,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.Generated.When}
             }}
          end

          def field_def("when") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "when",
               kind: {:scalar, :ALWAYS},
               label: :optional,
               name: :when,
               tag: 2,
               type: {:enum, Electric.Postgres.Schema.Proto.Constraint.Generated.When}
             }}
          end

          []
        ),
        (
          def field_def(:expr) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "expr",
               kind: {:scalar, nil},
               label: :optional,
               name: :expr,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("expr") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "expr",
               kind: {:scalar, nil},
               label: :optional,
               name: :expr,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:when) do
        {:ok, :ALWAYS}
      end,
      def default(:expr) do
        {:ok, nil}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.NotNull do
    @moduledoc false
    defstruct name: nil, deferrable: false, initdeferred: false

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_name(msg) |> encode_deferrable(msg) |> encode_initdeferred(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            case msg.name do
              nil -> [acc]
              child_field_value -> [acc, "\n", Protox.Encode.encode_string(child_field_value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_deferrable(acc, msg) do
          try do
            if msg.deferrable == false do
              acc
            else
              [acc, "\x18", Protox.Encode.encode_bool(msg.deferrable)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:deferrable, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_initdeferred(acc, msg) do
          try do
            if msg.initdeferred == false do
              acc
            else
              [acc, " ", Protox.Encode.encode_bool(msg.initdeferred)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:initdeferred, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Constraint.NotNull))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {3, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[deferrable: value], rest}

              {4, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[initdeferred: value], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Constraint.NotNull,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:oneof, :_name}, :string},
          3 => {:deferrable, {:scalar, false}, :bool},
          4 => {:initdeferred, {:scalar, false}, :bool}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          deferrable: {3, {:scalar, false}, :bool},
          initdeferred: {4, {:scalar, false}, :bool},
          name: {1, {:oneof, :_name}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:oneof, :_name},
            label: :proto3_optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "deferrable",
            kind: {:scalar, false},
            label: :optional,
            name: :deferrable,
            tag: 3,
            type: :bool
          },
          %{
            __struct__: Protox.Field,
            json_name: "initdeferred",
            kind: {:scalar, false},
            label: :optional,
            name: :initdeferred,
            tag: 4,
            type: :bool
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:oneof, :_name},
               label: :proto3_optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:oneof, :_name},
               label: :proto3_optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:deferrable) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 3,
               type: :bool
             }}
          end

          def field_def("deferrable") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 3,
               type: :bool
             }}
          end

          []
        ),
        (
          def field_def(:initdeferred) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 4,
               type: :bool
             }}
          end

          def field_def("initdeferred") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 4,
               type: :bool
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:error, :no_default_value}
      end,
      def default(:deferrable) do
        {:ok, false}
      end,
      def default(:initdeferred) do
        {:ok, false}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.PrimaryKey do
    @moduledoc false
    defstruct name: "", keys: [], including: [], deferrable: false, initdeferred: false

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          []
          |> encode_name(msg)
          |> encode_keys(msg)
          |> encode_including(msg)
          |> encode_deferrable(msg)
          |> encode_initdeferred(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_keys(acc, msg) do
          try do
            case msg.keys do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x1A", Protox.Encode.encode_string(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:keys, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_including(acc, msg) do
          try do
            case msg.including do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\"", Protox.Encode.encode_string(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:including, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_deferrable(acc, msg) do
          try do
            if msg.deferrable == false do
              acc
            else
              [acc, "(", Protox.Encode.encode_bool(msg.deferrable)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:deferrable, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_initdeferred(acc, msg) do
          try do
            if msg.initdeferred == false do
              acc
            else
              [acc, "0", Protox.Encode.encode_bool(msg.initdeferred)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:initdeferred, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Constraint.PrimaryKey))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[keys: msg.keys ++ [delimited]], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[including: msg.including ++ [delimited]], rest}

              {5, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[deferrable: value], rest}

              {6, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[initdeferred: value], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Constraint.PrimaryKey,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          3 => {:keys, :unpacked, :string},
          4 => {:including, :unpacked, :string},
          5 => {:deferrable, {:scalar, false}, :bool},
          6 => {:initdeferred, {:scalar, false}, :bool}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          deferrable: {5, {:scalar, false}, :bool},
          including: {4, :unpacked, :string},
          initdeferred: {6, {:scalar, false}, :bool},
          keys: {3, :unpacked, :string},
          name: {1, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "keys",
            kind: :unpacked,
            label: :repeated,
            name: :keys,
            tag: 3,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "including",
            kind: :unpacked,
            label: :repeated,
            name: :including,
            tag: 4,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "deferrable",
            kind: {:scalar, false},
            label: :optional,
            name: :deferrable,
            tag: 5,
            type: :bool
          },
          %{
            __struct__: Protox.Field,
            json_name: "initdeferred",
            kind: {:scalar, false},
            label: :optional,
            name: :initdeferred,
            tag: 6,
            type: :bool
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:keys) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "keys",
               kind: :unpacked,
               label: :repeated,
               name: :keys,
               tag: 3,
               type: :string
             }}
          end

          def field_def("keys") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "keys",
               kind: :unpacked,
               label: :repeated,
               name: :keys,
               tag: 3,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:including) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "including",
               kind: :unpacked,
               label: :repeated,
               name: :including,
               tag: 4,
               type: :string
             }}
          end

          def field_def("including") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "including",
               kind: :unpacked,
               label: :repeated,
               name: :including,
               tag: 4,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:deferrable) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 5,
               type: :bool
             }}
          end

          def field_def("deferrable") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 5,
               type: :bool
             }}
          end

          []
        ),
        (
          def field_def(:initdeferred) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 6,
               type: :bool
             }}
          end

          def field_def("initdeferred") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 6,
               type: :bool
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:keys) do
        {:error, :no_default_value}
      end,
      def default(:including) do
        {:error, :no_default_value}
      end,
      def default(:deferrable) do
        {:ok, false}
      end,
      def default(:initdeferred) do
        {:ok, false}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Constraint.Unique do
    @moduledoc false
    defstruct name: "", keys: [], including: [], deferrable: false, initdeferred: false

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          []
          |> encode_name(msg)
          |> encode_keys(msg)
          |> encode_including(msg)
          |> encode_deferrable(msg)
          |> encode_initdeferred(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_keys(acc, msg) do
          try do
            case msg.keys do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x1A", Protox.Encode.encode_string(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:keys, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_including(acc, msg) do
          try do
            case msg.including do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\"", Protox.Encode.encode_string(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:including, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_deferrable(acc, msg) do
          try do
            if msg.deferrable == false do
              acc
            else
              [acc, "(", Protox.Encode.encode_bool(msg.deferrable)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:deferrable, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_initdeferred(acc, msg) do
          try do
            if msg.initdeferred == false do
              acc
            else
              [acc, "0", Protox.Encode.encode_bool(msg.initdeferred)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:initdeferred, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Constraint.Unique))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[keys: msg.keys ++ [delimited]], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[including: msg.including ++ [delimited]], rest}

              {5, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[deferrable: value], rest}

              {6, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[initdeferred: value], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Constraint.Unique,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          3 => {:keys, :unpacked, :string},
          4 => {:including, :unpacked, :string},
          5 => {:deferrable, {:scalar, false}, :bool},
          6 => {:initdeferred, {:scalar, false}, :bool}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          deferrable: {5, {:scalar, false}, :bool},
          including: {4, :unpacked, :string},
          initdeferred: {6, {:scalar, false}, :bool},
          keys: {3, :unpacked, :string},
          name: {1, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "keys",
            kind: :unpacked,
            label: :repeated,
            name: :keys,
            tag: 3,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "including",
            kind: :unpacked,
            label: :repeated,
            name: :including,
            tag: 4,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "deferrable",
            kind: {:scalar, false},
            label: :optional,
            name: :deferrable,
            tag: 5,
            type: :bool
          },
          %{
            __struct__: Protox.Field,
            json_name: "initdeferred",
            kind: {:scalar, false},
            label: :optional,
            name: :initdeferred,
            tag: 6,
            type: :bool
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:keys) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "keys",
               kind: :unpacked,
               label: :repeated,
               name: :keys,
               tag: 3,
               type: :string
             }}
          end

          def field_def("keys") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "keys",
               kind: :unpacked,
               label: :repeated,
               name: :keys,
               tag: 3,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:including) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "including",
               kind: :unpacked,
               label: :repeated,
               name: :including,
               tag: 4,
               type: :string
             }}
          end

          def field_def("including") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "including",
               kind: :unpacked,
               label: :repeated,
               name: :including,
               tag: 4,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:deferrable) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 5,
               type: :bool
             }}
          end

          def field_def("deferrable") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "deferrable",
               kind: {:scalar, false},
               label: :optional,
               name: :deferrable,
               tag: 5,
               type: :bool
             }}
          end

          []
        ),
        (
          def field_def(:initdeferred) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 6,
               type: :bool
             }}
          end

          def field_def("initdeferred") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "initdeferred",
               kind: {:scalar, false},
               label: :optional,
               name: :initdeferred,
               tag: 6,
               type: :bool
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:keys) do
        {:error, :no_default_value}
      end,
      def default(:including) do
        {:error, :no_default_value}
      end,
      def default(:deferrable) do
        {:ok, false}
      end,
      def default(:initdeferred) do
        {:ok, false}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression do
    @moduledoc false
    defstruct expr: nil

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_expr(msg)
        end
      )

      [
        defp encode_expr(acc, msg) do
          case msg.expr do
            nil -> acc
            {:value, _field_value} -> encode_value(acc, msg)
            {:const, _field_value} -> encode_const(acc, msg)
            {:vfunction, _field_value} -> encode_vfunction(acc, msg)
            {:function, _field_value} -> encode_function(acc, msg)
            {:cast, _field_value} -> encode_cast(acc, msg)
            {:aexpr, _field_value} -> encode_aexpr(acc, msg)
            {:col_ref, _field_value} -> encode_col_ref(acc, msg)
            {:bool_expr, _field_value} -> encode_bool_expr(acc, msg)
            {:null_test, _field_value} -> encode_null_test(acc, msg)
          end
        end
      ]

      [
        defp encode_value(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, "\n", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:value, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_const(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, "\x12", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:const, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_vfunction(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, "\x1A", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:vfunction, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_function(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, "\"", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:function, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_cast(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, "*", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:cast, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_aexpr(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, "2", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:aexpr, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_col_ref(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, ":", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:col_ref, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_bool_expr(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, "B", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:bool_expr, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_null_test(acc, msg) do
          try do
            {_, child_field_value} = msg.expr
            [acc, "J", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:null_test, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:value, previous_value} ->
                       {:expr,
                        {:value,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.Value.decode!(delimited)
                         )}}

                     _ ->
                       {:expr,
                        {:value,
                         Electric.Postgres.Schema.Proto.Expression.Value.decode!(delimited)}}
                   end
                 ], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:const, previous_value} ->
                       {:expr,
                        {:const,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.Const.decode!(delimited)
                         )}}

                     _ ->
                       {:expr,
                        {:const,
                         Electric.Postgres.Schema.Proto.Expression.Const.decode!(delimited)}}
                   end
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:vfunction, previous_value} ->
                       {:expr,
                        {:vfunction,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.ValueFunction.decode!(
                             delimited
                           )
                         )}}

                     _ ->
                       {:expr,
                        {:vfunction,
                         Electric.Postgres.Schema.Proto.Expression.ValueFunction.decode!(
                           delimited
                         )}}
                   end
                 ], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:function, previous_value} ->
                       {:expr,
                        {:function,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.Function.decode!(delimited)
                         )}}

                     _ ->
                       {:expr,
                        {:function,
                         Electric.Postgres.Schema.Proto.Expression.Function.decode!(delimited)}}
                   end
                 ], rest}

              {5, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:cast, previous_value} ->
                       {:expr,
                        {:cast,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.Cast.decode!(delimited)
                         )}}

                     _ ->
                       {:expr,
                        {:cast, Electric.Postgres.Schema.Proto.Expression.Cast.decode!(delimited)}}
                   end
                 ], rest}

              {6, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:aexpr, previous_value} ->
                       {:expr,
                        {:aexpr,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.AExpr.decode!(delimited)
                         )}}

                     _ ->
                       {:expr,
                        {:aexpr,
                         Electric.Postgres.Schema.Proto.Expression.AExpr.decode!(delimited)}}
                   end
                 ], rest}

              {7, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:col_ref, previous_value} ->
                       {:expr,
                        {:col_ref,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.ColumnRef.decode!(delimited)
                         )}}

                     _ ->
                       {:expr,
                        {:col_ref,
                         Electric.Postgres.Schema.Proto.Expression.ColumnRef.decode!(delimited)}}
                   end
                 ], rest}

              {8, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:bool_expr, previous_value} ->
                       {:expr,
                        {:bool_expr,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.BoolExpr.decode!(delimited)
                         )}}

                     _ ->
                       {:expr,
                        {:bool_expr,
                         Electric.Postgres.Schema.Proto.Expression.BoolExpr.decode!(delimited)}}
                   end
                 ], rest}

              {9, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:null_test, previous_value} ->
                       {:expr,
                        {:null_test,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Postgres.Schema.Proto.Expression.NullTest.decode!(delimited)
                         )}}

                     _ ->
                       {:expr,
                        {:null_test,
                         Electric.Postgres.Schema.Proto.Expression.NullTest.decode!(delimited)}}
                   end
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 =>
            {:value, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.Value}},
          2 =>
            {:const, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.Const}},
          3 =>
            {:vfunction, {:oneof, :expr},
             {:message, Electric.Postgres.Schema.Proto.Expression.ValueFunction}},
          4 =>
            {:function, {:oneof, :expr},
             {:message, Electric.Postgres.Schema.Proto.Expression.Function}},
          5 =>
            {:cast, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.Cast}},
          6 =>
            {:aexpr, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.AExpr}},
          7 =>
            {:col_ref, {:oneof, :expr},
             {:message, Electric.Postgres.Schema.Proto.Expression.ColumnRef}},
          8 =>
            {:bool_expr, {:oneof, :expr},
             {:message, Electric.Postgres.Schema.Proto.Expression.BoolExpr}},
          9 =>
            {:null_test, {:oneof, :expr},
             {:message, Electric.Postgres.Schema.Proto.Expression.NullTest}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          aexpr:
            {6, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.AExpr}},
          bool_expr:
            {8, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.BoolExpr}},
          cast: {5, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.Cast}},
          col_ref:
            {7, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.ColumnRef}},
          const:
            {2, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.Const}},
          function:
            {4, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.Function}},
          null_test:
            {9, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.NullTest}},
          value:
            {1, {:oneof, :expr}, {:message, Electric.Postgres.Schema.Proto.Expression.Value}},
          vfunction:
            {3, {:oneof, :expr},
             {:message, Electric.Postgres.Schema.Proto.Expression.ValueFunction}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "value",
            kind: {:oneof, :expr},
            label: :optional,
            name: :value,
            tag: 1,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.Value}
          },
          %{
            __struct__: Protox.Field,
            json_name: "const",
            kind: {:oneof, :expr},
            label: :optional,
            name: :const,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.Const}
          },
          %{
            __struct__: Protox.Field,
            json_name: "vfunction",
            kind: {:oneof, :expr},
            label: :optional,
            name: :vfunction,
            tag: 3,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.ValueFunction}
          },
          %{
            __struct__: Protox.Field,
            json_name: "function",
            kind: {:oneof, :expr},
            label: :optional,
            name: :function,
            tag: 4,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.Function}
          },
          %{
            __struct__: Protox.Field,
            json_name: "cast",
            kind: {:oneof, :expr},
            label: :optional,
            name: :cast,
            tag: 5,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.Cast}
          },
          %{
            __struct__: Protox.Field,
            json_name: "aexpr",
            kind: {:oneof, :expr},
            label: :optional,
            name: :aexpr,
            tag: 6,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.AExpr}
          },
          %{
            __struct__: Protox.Field,
            json_name: "colRef",
            kind: {:oneof, :expr},
            label: :optional,
            name: :col_ref,
            tag: 7,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.ColumnRef}
          },
          %{
            __struct__: Protox.Field,
            json_name: "boolExpr",
            kind: {:oneof, :expr},
            label: :optional,
            name: :bool_expr,
            tag: 8,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.BoolExpr}
          },
          %{
            __struct__: Protox.Field,
            json_name: "nullTest",
            kind: {:oneof, :expr},
            label: :optional,
            name: :null_test,
            tag: 9,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.NullTest}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:value) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "value",
               kind: {:oneof, :expr},
               label: :optional,
               name: :value,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Value}
             }}
          end

          def field_def("value") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "value",
               kind: {:oneof, :expr},
               label: :optional,
               name: :value,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Value}
             }}
          end

          []
        ),
        (
          def field_def(:const) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "const",
               kind: {:oneof, :expr},
               label: :optional,
               name: :const,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Const}
             }}
          end

          def field_def("const") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "const",
               kind: {:oneof, :expr},
               label: :optional,
               name: :const,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Const}
             }}
          end

          []
        ),
        (
          def field_def(:vfunction) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "vfunction",
               kind: {:oneof, :expr},
               label: :optional,
               name: :vfunction,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.ValueFunction}
             }}
          end

          def field_def("vfunction") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "vfunction",
               kind: {:oneof, :expr},
               label: :optional,
               name: :vfunction,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.ValueFunction}
             }}
          end

          []
        ),
        (
          def field_def(:function) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "function",
               kind: {:oneof, :expr},
               label: :optional,
               name: :function,
               tag: 4,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Function}
             }}
          end

          def field_def("function") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "function",
               kind: {:oneof, :expr},
               label: :optional,
               name: :function,
               tag: 4,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Function}
             }}
          end

          []
        ),
        (
          def field_def(:cast) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "cast",
               kind: {:oneof, :expr},
               label: :optional,
               name: :cast,
               tag: 5,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Cast}
             }}
          end

          def field_def("cast") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "cast",
               kind: {:oneof, :expr},
               label: :optional,
               name: :cast,
               tag: 5,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Cast}
             }}
          end

          []
        ),
        (
          def field_def(:aexpr) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "aexpr",
               kind: {:oneof, :expr},
               label: :optional,
               name: :aexpr,
               tag: 6,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.AExpr}
             }}
          end

          def field_def("aexpr") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "aexpr",
               kind: {:oneof, :expr},
               label: :optional,
               name: :aexpr,
               tag: 6,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.AExpr}
             }}
          end

          []
        ),
        (
          def field_def(:col_ref) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "colRef",
               kind: {:oneof, :expr},
               label: :optional,
               name: :col_ref,
               tag: 7,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.ColumnRef}
             }}
          end

          def field_def("colRef") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "colRef",
               kind: {:oneof, :expr},
               label: :optional,
               name: :col_ref,
               tag: 7,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.ColumnRef}
             }}
          end

          def field_def("col_ref") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "colRef",
               kind: {:oneof, :expr},
               label: :optional,
               name: :col_ref,
               tag: 7,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.ColumnRef}
             }}
          end
        ),
        (
          def field_def(:bool_expr) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "boolExpr",
               kind: {:oneof, :expr},
               label: :optional,
               name: :bool_expr,
               tag: 8,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.BoolExpr}
             }}
          end

          def field_def("boolExpr") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "boolExpr",
               kind: {:oneof, :expr},
               label: :optional,
               name: :bool_expr,
               tag: 8,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.BoolExpr}
             }}
          end

          def field_def("bool_expr") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "boolExpr",
               kind: {:oneof, :expr},
               label: :optional,
               name: :bool_expr,
               tag: 8,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.BoolExpr}
             }}
          end
        ),
        (
          def field_def(:null_test) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullTest",
               kind: {:oneof, :expr},
               label: :optional,
               name: :null_test,
               tag: 9,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.NullTest}
             }}
          end

          def field_def("nullTest") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullTest",
               kind: {:oneof, :expr},
               label: :optional,
               name: :null_test,
               tag: 9,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.NullTest}
             }}
          end

          def field_def("null_test") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullTest",
               kind: {:oneof, :expr},
               label: :optional,
               name: :null_test,
               tag: 9,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.NullTest}
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:value) do
        {:error, :no_default_value}
      end,
      def default(:const) do
        {:error, :no_default_value}
      end,
      def default(:vfunction) do
        {:error, :no_default_value}
      end,
      def default(:function) do
        {:error, :no_default_value}
      end,
      def default(:cast) do
        {:error, :no_default_value}
      end,
      def default(:aexpr) do
        {:error, :no_default_value}
      end,
      def default(:col_ref) do
        {:error, :no_default_value}
      end,
      def default(:bool_expr) do
        {:error, :no_default_value}
      end,
      def default(:null_test) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.AExpr do
    @moduledoc false
    defstruct name: "", left: nil, right: nil

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_name(msg) |> encode_left(msg) |> encode_right(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_left(acc, msg) do
          try do
            if msg.left == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.left)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:left, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_right(acc, msg) do
          try do
            if msg.right == nil do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_message(msg.right)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:right, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression.AExpr))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   left:
                     Protox.MergeMessage.merge(
                       msg.left,
                       Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                     )
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   right:
                     Protox.MergeMessage.merge(
                       msg.right,
                       Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                     )
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.AExpr,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:left, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          3 => {:right, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          left: {2, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          name: {1, {:scalar, ""}, :string},
          right: {3, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "left",
            kind: {:scalar, nil},
            label: :optional,
            name: :left,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          },
          %{
            __struct__: Protox.Field,
            json_name: "right",
            kind: {:scalar, nil},
            label: :optional,
            name: :right,
            tag: 3,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:left) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "left",
               kind: {:scalar, nil},
               label: :optional,
               name: :left,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("left") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "left",
               kind: {:scalar, nil},
               label: :optional,
               name: :left,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        (
          def field_def(:right) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "right",
               kind: {:scalar, nil},
               label: :optional,
               name: :right,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("right") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "right",
               kind: {:scalar, nil},
               label: :optional,
               name: :right,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:left) do
        {:ok, nil}
      end,
      def default(:right) do
        {:ok, nil}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.BoolExpr do
    @moduledoc false
    defstruct op: :AND, args: []

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_op(msg) |> encode_args(msg)
        end
      )

      []

      [
        defp encode_op(acc, msg) do
          try do
            if msg.op == :AND do
              acc
            else
              [
                acc,
                "\b",
                msg.op
                |> Electric.Postgres.Schema.Proto.Expression.BoolExpr.Op.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:op, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_args(acc, msg) do
          try do
            case msg.args do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x12", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:args, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression.BoolExpr))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Postgres.Schema.Proto.Expression.BoolExpr.Op
                  )

                {[op: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   args:
                     msg.args ++ [Electric.Postgres.Schema.Proto.Expression.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.BoolExpr,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 =>
            {:op, {:scalar, :AND}, {:enum, Electric.Postgres.Schema.Proto.Expression.BoolExpr.Op}},
          2 => {:args, :unpacked, {:message, Electric.Postgres.Schema.Proto.Expression}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          args: {2, :unpacked, {:message, Electric.Postgres.Schema.Proto.Expression}},
          op: {1, {:scalar, :AND}, {:enum, Electric.Postgres.Schema.Proto.Expression.BoolExpr.Op}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "op",
            kind: {:scalar, :AND},
            label: :optional,
            name: :op,
            tag: 1,
            type: {:enum, Electric.Postgres.Schema.Proto.Expression.BoolExpr.Op}
          },
          %{
            __struct__: Protox.Field,
            json_name: "args",
            kind: :unpacked,
            label: :repeated,
            name: :args,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:op) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "op",
               kind: {:scalar, :AND},
               label: :optional,
               name: :op,
               tag: 1,
               type: {:enum, Electric.Postgres.Schema.Proto.Expression.BoolExpr.Op}
             }}
          end

          def field_def("op") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "op",
               kind: {:scalar, :AND},
               label: :optional,
               name: :op,
               tag: 1,
               type: {:enum, Electric.Postgres.Schema.Proto.Expression.BoolExpr.Op}
             }}
          end

          []
        ),
        (
          def field_def(:args) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "args",
               kind: :unpacked,
               label: :repeated,
               name: :args,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("args") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "args",
               kind: :unpacked,
               label: :repeated,
               name: :args,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:op) do
        {:ok, :AND}
      end,
      def default(:args) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.Cast do
    @moduledoc false
    defstruct type: nil, arg: nil

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_type(msg) |> encode_arg(msg)
        end
      )

      []

      [
        defp encode_type(acc, msg) do
          try do
            if msg.type == nil do
              acc
            else
              [acc, "\n", Protox.Encode.encode_message(msg.type)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:type, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_arg(acc, msg) do
          try do
            if msg.arg == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.arg)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:arg, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression.Cast))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   type:
                     Protox.MergeMessage.merge(
                       msg.type,
                       Electric.Postgres.Schema.Proto.Column.Type.decode!(delimited)
                     )
                 ], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   arg:
                     Protox.MergeMessage.merge(
                       msg.arg,
                       Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                     )
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.Cast,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:type, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Column.Type}},
          2 => {:arg, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          arg: {2, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          type: {1, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Column.Type}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "type",
            kind: {:scalar, nil},
            label: :optional,
            name: :type,
            tag: 1,
            type: {:message, Electric.Postgres.Schema.Proto.Column.Type}
          },
          %{
            __struct__: Protox.Field,
            json_name: "arg",
            kind: {:scalar, nil},
            label: :optional,
            name: :arg,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, nil},
               label: :optional,
               name: :type,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Column.Type}
             }}
          end

          def field_def("type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, nil},
               label: :optional,
               name: :type,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Column.Type}
             }}
          end

          []
        ),
        (
          def field_def(:arg) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "arg",
               kind: {:scalar, nil},
               label: :optional,
               name: :arg,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("arg") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "arg",
               kind: {:scalar, nil},
               label: :optional,
               name: :arg,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:type) do
        {:ok, nil}
      end,
      def default(:arg) do
        {:ok, nil}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.ColumnRef do
    @moduledoc false
    defstruct name: ""

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_name(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression.ColumnRef))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.ColumnRef,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{1 => {:name, {:scalar, ""}, :string}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{name: {1, {:scalar, ""}, :string}}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.Const do
    @moduledoc false
    defstruct value: nil

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_value(msg)
        end
      )

      []

      [
        defp encode_value(acc, msg) do
          try do
            if msg.value == nil do
              acc
            else
              [acc, "\n", Protox.Encode.encode_message(msg.value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:value, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression.Const))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   value:
                     Protox.MergeMessage.merge(
                       msg.value,
                       Electric.Postgres.Schema.Proto.Expression.Value.decode!(delimited)
                     )
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.Const,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 =>
            {:value, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression.Value}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{value: {1, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression.Value}}}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "value",
            kind: {:scalar, nil},
            label: :optional,
            name: :value,
            tag: 1,
            type: {:message, Electric.Postgres.Schema.Proto.Expression.Value}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:value) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "value",
               kind: {:scalar, nil},
               label: :optional,
               name: :value,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Value}
             }}
          end

          def field_def("value") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "value",
               kind: {:scalar, nil},
               label: :optional,
               name: :value,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Expression.Value}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:value) do
        {:ok, nil}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.Function do
    @moduledoc false
    defstruct name: "", args: []

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_name(msg) |> encode_args(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_args(acc, msg) do
          try do
            case msg.args do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x12", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:args, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression.Function))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   args:
                     msg.args ++ [Electric.Postgres.Schema.Proto.Expression.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.Function,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:args, :unpacked, {:message, Electric.Postgres.Schema.Proto.Expression}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          args: {2, :unpacked, {:message, Electric.Postgres.Schema.Proto.Expression}},
          name: {1, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "args",
            kind: :unpacked,
            label: :repeated,
            name: :args,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:args) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "args",
               kind: :unpacked,
               label: :repeated,
               name: :args,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("args") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "args",
               kind: :unpacked,
               label: :repeated,
               name: :args,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:args) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.NullTest do
    @moduledoc false
    defstruct type: :IS, arg: nil, isrow: false

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_type(msg) |> encode_arg(msg) |> encode_isrow(msg)
        end
      )

      []

      [
        defp encode_type(acc, msg) do
          try do
            if msg.type == :IS do
              acc
            else
              [
                acc,
                "\b",
                msg.type
                |> Electric.Postgres.Schema.Proto.Expression.NullTest.TestType.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:type, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_arg(acc, msg) do
          try do
            if msg.arg == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.arg)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:arg, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_isrow(acc, msg) do
          try do
            if msg.isrow == false do
              acc
            else
              [acc, "\x18", Protox.Encode.encode_bool(msg.isrow)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:isrow, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression.NullTest))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Postgres.Schema.Proto.Expression.NullTest.TestType
                  )

                {[type: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   arg:
                     Protox.MergeMessage.merge(
                       msg.arg,
                       Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                     )
                 ], rest}

              {3, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[isrow: value], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.NullTest,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 =>
            {:type, {:scalar, :IS},
             {:enum, Electric.Postgres.Schema.Proto.Expression.NullTest.TestType}},
          2 => {:arg, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          3 => {:isrow, {:scalar, false}, :bool}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          arg: {2, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          isrow: {3, {:scalar, false}, :bool},
          type:
            {1, {:scalar, :IS},
             {:enum, Electric.Postgres.Schema.Proto.Expression.NullTest.TestType}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "type",
            kind: {:scalar, :IS},
            label: :optional,
            name: :type,
            tag: 1,
            type: {:enum, Electric.Postgres.Schema.Proto.Expression.NullTest.TestType}
          },
          %{
            __struct__: Protox.Field,
            json_name: "arg",
            kind: {:scalar, nil},
            label: :optional,
            name: :arg,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          },
          %{
            __struct__: Protox.Field,
            json_name: "isrow",
            kind: {:scalar, false},
            label: :optional,
            name: :isrow,
            tag: 3,
            type: :bool
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, :IS},
               label: :optional,
               name: :type,
               tag: 1,
               type: {:enum, Electric.Postgres.Schema.Proto.Expression.NullTest.TestType}
             }}
          end

          def field_def("type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, :IS},
               label: :optional,
               name: :type,
               tag: 1,
               type: {:enum, Electric.Postgres.Schema.Proto.Expression.NullTest.TestType}
             }}
          end

          []
        ),
        (
          def field_def(:arg) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "arg",
               kind: {:scalar, nil},
               label: :optional,
               name: :arg,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("arg") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "arg",
               kind: {:scalar, nil},
               label: :optional,
               name: :arg,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        (
          def field_def(:isrow) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "isrow",
               kind: {:scalar, false},
               label: :optional,
               name: :isrow,
               tag: 3,
               type: :bool
             }}
          end

          def field_def("isrow") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "isrow",
               kind: {:scalar, false},
               label: :optional,
               name: :isrow,
               tag: 3,
               type: :bool
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:type) do
        {:ok, :IS}
      end,
      def default(:arg) do
        {:ok, nil}
      end,
      def default(:isrow) do
        {:ok, false}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.Value do
    @moduledoc false
    defstruct type: :STRING, value: ""

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_type(msg) |> encode_value(msg)
        end
      )

      []

      [
        defp encode_type(acc, msg) do
          try do
            if msg.type == :STRING do
              acc
            else
              [
                acc,
                "\b",
                msg.type
                |> Electric.Postgres.Schema.Proto.Expression.Value.Type.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:type, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_value(acc, msg) do
          try do
            if msg.value == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:value, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Expression.Value))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Postgres.Schema.Proto.Expression.Value.Type
                  )

                {[type: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[value: delimited], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.Value,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 =>
            {:type, {:scalar, :STRING},
             {:enum, Electric.Postgres.Schema.Proto.Expression.Value.Type}},
          2 => {:value, {:scalar, ""}, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          type:
            {1, {:scalar, :STRING}, {:enum, Electric.Postgres.Schema.Proto.Expression.Value.Type}},
          value: {2, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "type",
            kind: {:scalar, :STRING},
            label: :optional,
            name: :type,
            tag: 1,
            type: {:enum, Electric.Postgres.Schema.Proto.Expression.Value.Type}
          },
          %{
            __struct__: Protox.Field,
            json_name: "value",
            kind: {:scalar, ""},
            label: :optional,
            name: :value,
            tag: 2,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, :STRING},
               label: :optional,
               name: :type,
               tag: 1,
               type: {:enum, Electric.Postgres.Schema.Proto.Expression.Value.Type}
             }}
          end

          def field_def("type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, :STRING},
               label: :optional,
               name: :type,
               tag: 1,
               type: {:enum, Electric.Postgres.Schema.Proto.Expression.Value.Type}
             }}
          end

          []
        ),
        (
          def field_def(:value) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "value",
               kind: {:scalar, ""},
               label: :optional,
               name: :value,
               tag: 2,
               type: :string
             }}
          end

          def field_def("value") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "value",
               kind: {:scalar, ""},
               label: :optional,
               name: :value,
               tag: 2,
               type: :string
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:type) do
        {:ok, :STRING}
      end,
      def default(:value) do
        {:ok, ""}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Expression.ValueFunction do
    @moduledoc false
    defstruct name: "", args: []

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_name(msg) |> encode_args(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_args(acc, msg) do
          try do
            case msg.args do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x12", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:args, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(
              bytes,
              struct(Electric.Postgres.Schema.Proto.Expression.ValueFunction)
            )
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   args:
                     msg.args ++ [Electric.Postgres.Schema.Proto.Expression.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Expression.ValueFunction,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:args, :unpacked, {:message, Electric.Postgres.Schema.Proto.Expression}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          args: {2, :unpacked, {:message, Electric.Postgres.Schema.Proto.Expression}},
          name: {1, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "args",
            kind: :unpacked,
            label: :repeated,
            name: :args,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:args) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "args",
               kind: :unpacked,
               label: :repeated,
               name: :args,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("args") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "args",
               kind: :unpacked,
               label: :repeated,
               name: :args,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:args) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Index do
    @moduledoc false
    defstruct name: "",
              table: nil,
              unique: false,
              columns: [],
              including: [],
              where: nil,
              using: ""

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          []
          |> encode_name(msg)
          |> encode_table(msg)
          |> encode_unique(msg)
          |> encode_columns(msg)
          |> encode_including(msg)
          |> encode_where(msg)
          |> encode_using(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_table(acc, msg) do
          try do
            if msg.table == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.table)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:table, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_unique(acc, msg) do
          try do
            if msg.unique == false do
              acc
            else
              [acc, "\x18", Protox.Encode.encode_bool(msg.unique)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:unique, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_columns(acc, msg) do
          try do
            case msg.columns do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\"", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:columns, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_including(acc, msg) do
          try do
            case msg.including do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "*", Protox.Encode.encode_string(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:including, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_where(acc, msg) do
          try do
            if msg.where == nil do
              acc
            else
              [acc, "2", Protox.Encode.encode_message(msg.where)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:where, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_using(acc, msg) do
          try do
            if msg.using == "" do
              acc
            else
              [acc, ":", Protox.Encode.encode_string(msg.using)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:using, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Index))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   table:
                     Protox.MergeMessage.merge(
                       msg.table,
                       Electric.Postgres.Schema.Proto.RangeVar.decode!(delimited)
                     )
                 ], rest}

              {3, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[unique: value], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   columns:
                     msg.columns ++
                       [Electric.Postgres.Schema.Proto.Index.Column.decode!(delimited)]
                 ], rest}

              {5, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[including: msg.including ++ [delimited]], rest}

              {6, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   where:
                     Protox.MergeMessage.merge(
                       msg.where,
                       Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                     )
                 ], rest}

              {7, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[using: delimited], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Index,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:table, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.RangeVar}},
          3 => {:unique, {:scalar, false}, :bool},
          4 => {:columns, :unpacked, {:message, Electric.Postgres.Schema.Proto.Index.Column}},
          5 => {:including, :unpacked, :string},
          6 => {:where, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          7 => {:using, {:scalar, ""}, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          columns: {4, :unpacked, {:message, Electric.Postgres.Schema.Proto.Index.Column}},
          including: {5, :unpacked, :string},
          name: {1, {:scalar, ""}, :string},
          table: {2, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.RangeVar}},
          unique: {3, {:scalar, false}, :bool},
          using: {7, {:scalar, ""}, :string},
          where: {6, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.Expression}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "table",
            kind: {:scalar, nil},
            label: :optional,
            name: :table,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
          },
          %{
            __struct__: Protox.Field,
            json_name: "unique",
            kind: {:scalar, false},
            label: :optional,
            name: :unique,
            tag: 3,
            type: :bool
          },
          %{
            __struct__: Protox.Field,
            json_name: "columns",
            kind: :unpacked,
            label: :repeated,
            name: :columns,
            tag: 4,
            type: {:message, Electric.Postgres.Schema.Proto.Index.Column}
          },
          %{
            __struct__: Protox.Field,
            json_name: "including",
            kind: :unpacked,
            label: :repeated,
            name: :including,
            tag: 5,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "where",
            kind: {:scalar, nil},
            label: :optional,
            name: :where,
            tag: 6,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          },
          %{
            __struct__: Protox.Field,
            json_name: "using",
            kind: {:scalar, ""},
            label: :optional,
            name: :using,
            tag: 7,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:table) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "table",
               kind: {:scalar, nil},
               label: :optional,
               name: :table,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
             }}
          end

          def field_def("table") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "table",
               kind: {:scalar, nil},
               label: :optional,
               name: :table,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
             }}
          end

          []
        ),
        (
          def field_def(:unique) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "unique",
               kind: {:scalar, false},
               label: :optional,
               name: :unique,
               tag: 3,
               type: :bool
             }}
          end

          def field_def("unique") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "unique",
               kind: {:scalar, false},
               label: :optional,
               name: :unique,
               tag: 3,
               type: :bool
             }}
          end

          []
        ),
        (
          def field_def(:columns) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "columns",
               kind: :unpacked,
               label: :repeated,
               name: :columns,
               tag: 4,
               type: {:message, Electric.Postgres.Schema.Proto.Index.Column}
             }}
          end

          def field_def("columns") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "columns",
               kind: :unpacked,
               label: :repeated,
               name: :columns,
               tag: 4,
               type: {:message, Electric.Postgres.Schema.Proto.Index.Column}
             }}
          end

          []
        ),
        (
          def field_def(:including) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "including",
               kind: :unpacked,
               label: :repeated,
               name: :including,
               tag: 5,
               type: :string
             }}
          end

          def field_def("including") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "including",
               kind: :unpacked,
               label: :repeated,
               name: :including,
               tag: 5,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:where) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "where",
               kind: {:scalar, nil},
               label: :optional,
               name: :where,
               tag: 6,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("where") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "where",
               kind: {:scalar, nil},
               label: :optional,
               name: :where,
               tag: 6,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        (
          def field_def(:using) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "using",
               kind: {:scalar, ""},
               label: :optional,
               name: :using,
               tag: 7,
               type: :string
             }}
          end

          def field_def("using") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "using",
               kind: {:scalar, ""},
               label: :optional,
               name: :using,
               tag: 7,
               type: :string
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:table) do
        {:ok, nil}
      end,
      def default(:unique) do
        {:ok, false}
      end,
      def default(:columns) do
        {:error, :no_default_value}
      end,
      def default(:including) do
        {:error, :no_default_value}
      end,
      def default(:where) do
        {:ok, nil}
      end,
      def default(:using) do
        {:ok, ""}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Index.Column do
    @moduledoc false
    defstruct name: nil, collation: nil, expr: nil, ordering: :ASC, nulls_ordering: :LAST

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          []
          |> encode_name(msg)
          |> encode_collation(msg)
          |> encode_expr(msg)
          |> encode_ordering(msg)
          |> encode_nulls_ordering(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            case msg.name do
              nil -> [acc]
              child_field_value -> [acc, "\n", Protox.Encode.encode_string(child_field_value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_collation(acc, msg) do
          try do
            case msg.collation do
              nil -> [acc]
              child_field_value -> [acc, "\x12", Protox.Encode.encode_string(child_field_value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:collation, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_expr(acc, msg) do
          try do
            case msg.expr do
              nil -> [acc]
              child_field_value -> [acc, "\x1A", Protox.Encode.encode_message(child_field_value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:expr, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_ordering(acc, msg) do
          try do
            if msg.ordering == :ASC do
              acc
            else
              [
                acc,
                " ",
                msg.ordering
                |> Electric.Postgres.Schema.Proto.Index.Ordering.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:ordering, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_nulls_ordering(acc, msg) do
          try do
            if msg.nulls_ordering == :LAST do
              acc
            else
              [
                acc,
                "(",
                msg.nulls_ordering
                |> Electric.Postgres.Schema.Proto.Index.NullsOrdering.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:nulls_ordering, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Index.Column))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[collation: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.expr do
                     {:expr, previous_value} ->
                       {:expr,
                        Protox.MergeMessage.merge(
                          previous_value,
                          Electric.Postgres.Schema.Proto.Expression.decode!(delimited)
                        )}

                     _ ->
                       {:expr, Electric.Postgres.Schema.Proto.Expression.decode!(delimited)}
                   end
                 ], rest}

              {4, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(bytes, Electric.Postgres.Schema.Proto.Index.Ordering)

                {[ordering: value], rest}

              {5, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Postgres.Schema.Proto.Index.NullsOrdering
                  )

                {[nulls_ordering: value], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Index.Column,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:oneof, :_name}, :string},
          2 => {:collation, {:oneof, :_collation}, :string},
          3 => {:expr, {:oneof, :_expr}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          4 =>
            {:ordering, {:scalar, :ASC}, {:enum, Electric.Postgres.Schema.Proto.Index.Ordering}},
          5 =>
            {:nulls_ordering, {:scalar, :LAST},
             {:enum, Electric.Postgres.Schema.Proto.Index.NullsOrdering}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          collation: {2, {:oneof, :_collation}, :string},
          expr: {3, {:oneof, :_expr}, {:message, Electric.Postgres.Schema.Proto.Expression}},
          name: {1, {:oneof, :_name}, :string},
          nulls_ordering:
            {5, {:scalar, :LAST}, {:enum, Electric.Postgres.Schema.Proto.Index.NullsOrdering}},
          ordering: {4, {:scalar, :ASC}, {:enum, Electric.Postgres.Schema.Proto.Index.Ordering}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:oneof, :_name},
            label: :proto3_optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "collation",
            kind: {:oneof, :_collation},
            label: :proto3_optional,
            name: :collation,
            tag: 2,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "expr",
            kind: {:oneof, :_expr},
            label: :proto3_optional,
            name: :expr,
            tag: 3,
            type: {:message, Electric.Postgres.Schema.Proto.Expression}
          },
          %{
            __struct__: Protox.Field,
            json_name: "ordering",
            kind: {:scalar, :ASC},
            label: :optional,
            name: :ordering,
            tag: 4,
            type: {:enum, Electric.Postgres.Schema.Proto.Index.Ordering}
          },
          %{
            __struct__: Protox.Field,
            json_name: "nullsOrdering",
            kind: {:scalar, :LAST},
            label: :optional,
            name: :nulls_ordering,
            tag: 5,
            type: {:enum, Electric.Postgres.Schema.Proto.Index.NullsOrdering}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:oneof, :_name},
               label: :proto3_optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:oneof, :_name},
               label: :proto3_optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:collation) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "collation",
               kind: {:oneof, :_collation},
               label: :proto3_optional,
               name: :collation,
               tag: 2,
               type: :string
             }}
          end

          def field_def("collation") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "collation",
               kind: {:oneof, :_collation},
               label: :proto3_optional,
               name: :collation,
               tag: 2,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:expr) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "expr",
               kind: {:oneof, :_expr},
               label: :proto3_optional,
               name: :expr,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          def field_def("expr") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "expr",
               kind: {:oneof, :_expr},
               label: :proto3_optional,
               name: :expr,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Expression}
             }}
          end

          []
        ),
        (
          def field_def(:ordering) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "ordering",
               kind: {:scalar, :ASC},
               label: :optional,
               name: :ordering,
               tag: 4,
               type: {:enum, Electric.Postgres.Schema.Proto.Index.Ordering}
             }}
          end

          def field_def("ordering") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "ordering",
               kind: {:scalar, :ASC},
               label: :optional,
               name: :ordering,
               tag: 4,
               type: {:enum, Electric.Postgres.Schema.Proto.Index.Ordering}
             }}
          end

          []
        ),
        (
          def field_def(:nulls_ordering) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullsOrdering",
               kind: {:scalar, :LAST},
               label: :optional,
               name: :nulls_ordering,
               tag: 5,
               type: {:enum, Electric.Postgres.Schema.Proto.Index.NullsOrdering}
             }}
          end

          def field_def("nullsOrdering") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullsOrdering",
               kind: {:scalar, :LAST},
               label: :optional,
               name: :nulls_ordering,
               tag: 5,
               type: {:enum, Electric.Postgres.Schema.Proto.Index.NullsOrdering}
             }}
          end

          def field_def("nulls_ordering") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullsOrdering",
               kind: {:scalar, :LAST},
               label: :optional,
               name: :nulls_ordering,
               tag: 5,
               type: {:enum, Electric.Postgres.Schema.Proto.Index.NullsOrdering}
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:error, :no_default_value}
      end,
      def default(:collation) do
        {:error, :no_default_value}
      end,
      def default(:expr) do
        {:error, :no_default_value}
      end,
      def default(:ordering) do
        {:ok, :ASC}
      end,
      def default(:nulls_ordering) do
        {:ok, :LAST}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.RangeVar do
    @moduledoc false
    defstruct name: "", schema: nil, alias: nil

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_schema(msg) |> encode_alias(msg) |> encode_name(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_schema(acc, msg) do
          try do
            case msg.schema do
              nil -> [acc]
              child_field_value -> [acc, "\x12", Protox.Encode.encode_string(child_field_value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:schema, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_alias(acc, msg) do
          try do
            case msg.alias do
              nil -> [acc]
              child_field_value -> [acc, "\x1A", Protox.Encode.encode_string(child_field_value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:alias, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.RangeVar))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[name: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[schema: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[alias: delimited], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.RangeVar,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, ""}, :string},
          2 => {:schema, {:oneof, :_schema}, :string},
          3 => {:alias, {:oneof, :_alias}, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          alias: {3, {:oneof, :_alias}, :string},
          name: {1, {:scalar, ""}, :string},
          schema: {2, {:oneof, :_schema}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, ""},
            label: :optional,
            name: :name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "schema",
            kind: {:oneof, :_schema},
            label: :proto3_optional,
            name: :schema,
            tag: 2,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "alias",
            kind: {:oneof, :_alias},
            label: :proto3_optional,
            name: :alias,
            tag: 3,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, ""},
               label: :optional,
               name: :name,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:schema) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "schema",
               kind: {:oneof, :_schema},
               label: :proto3_optional,
               name: :schema,
               tag: 2,
               type: :string
             }}
          end

          def field_def("schema") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "schema",
               kind: {:oneof, :_schema},
               label: :proto3_optional,
               name: :schema,
               tag: 2,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:alias) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "alias",
               kind: {:oneof, :_alias},
               label: :proto3_optional,
               name: :alias,
               tag: 3,
               type: :string
             }}
          end

          def field_def("alias") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "alias",
               kind: {:oneof, :_alias},
               label: :proto3_optional,
               name: :alias,
               tag: 3,
               type: :string
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, ""}
      end,
      def default(:schema) do
        {:error, :no_default_value}
      end,
      def default(:alias) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Schema do
    @moduledoc false
    defstruct tables: []

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          [] |> encode_tables(msg)
        end
      )

      []

      [
        defp encode_tables(acc, msg) do
          try do
            case msg.tables do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\n", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:tables, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Schema))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   tables: msg.tables ++ [Electric.Postgres.Schema.Proto.Table.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Schema,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{1 => {:tables, :unpacked, {:message, Electric.Postgres.Schema.Proto.Table}}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{tables: {1, :unpacked, {:message, Electric.Postgres.Schema.Proto.Table}}}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "tables",
            kind: :unpacked,
            label: :repeated,
            name: :tables,
            tag: 1,
            type: {:message, Electric.Postgres.Schema.Proto.Table}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:tables) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tables",
               kind: :unpacked,
               label: :repeated,
               name: :tables,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Table}
             }}
          end

          def field_def("tables") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tables",
               kind: :unpacked,
               label: :repeated,
               name: :tables,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.Table}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:tables) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end,
  defmodule Electric.Postgres.Schema.Proto.Table do
    @moduledoc false
    defstruct name: nil, columns: [], constraints: [], indexes: []

    (
      (
        @spec encode(struct) :: {:ok, iodata} | {:error, any}
        def encode(msg) do
          try do
            {:ok, encode!(msg)}
          rescue
            e in [Protox.EncodingError, Protox.RequiredFieldsError] -> {:error, e}
          end
        end

        @spec encode!(struct) :: iodata | no_return
        def encode!(msg) do
          []
          |> encode_name(msg)
          |> encode_columns(msg)
          |> encode_constraints(msg)
          |> encode_indexes(msg)
        end
      )

      []

      [
        defp encode_name(acc, msg) do
          try do
            if msg.name == nil do
              acc
            else
              [acc, "\n", Protox.Encode.encode_message(msg.name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_columns(acc, msg) do
          try do
            case msg.columns do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x12", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:columns, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_constraints(acc, msg) do
          try do
            case msg.constraints do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x1A", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:constraints, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_indexes(acc, msg) do
          try do
            case msg.indexes do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\"", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:indexes, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      []
    )

    (
      (
        @spec decode(binary) :: {:ok, struct} | {:error, any}
        def decode(bytes) do
          try do
            {:ok, decode!(bytes)}
          rescue
            e in [Protox.DecodingError, Protox.IllegalTagError, Protox.RequiredFieldsError] ->
              {:error, e}
          end
        end

        (
          @spec decode!(binary) :: struct | no_return
          def decode!(bytes) do
            parse_key_value(bytes, struct(Electric.Postgres.Schema.Proto.Table))
          end
        )
      )

      (
        @spec parse_key_value(binary, struct) :: struct
        defp parse_key_value(<<>>, msg) do
          msg
        end

        defp parse_key_value(bytes, msg) do
          {field, rest} =
            case Protox.Decode.parse_key(bytes) do
              {0, _, _} ->
                raise %Protox.IllegalTagError{}

              {1, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   name:
                     Protox.MergeMessage.merge(
                       msg.name,
                       Electric.Postgres.Schema.Proto.RangeVar.decode!(delimited)
                     )
                 ], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   columns:
                     msg.columns ++ [Electric.Postgres.Schema.Proto.Column.decode!(delimited)]
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   constraints:
                     msg.constraints ++
                       [Electric.Postgres.Schema.Proto.Constraint.decode!(delimited)]
                 ], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   indexes:
                     msg.indexes ++ [Electric.Postgres.Schema.Proto.Index.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {_, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)
                {[], rest}
            end

          msg_updated = struct(msg, field)
          parse_key_value(rest, msg_updated)
        end
      )

      []
    )

    (
      @spec json_decode(iodata(), keyword()) :: {:ok, struct()} | {:error, any()}
      def json_decode(input, opts \\ []) do
        try do
          {:ok, json_decode!(input, opts)}
        rescue
          e in Protox.JsonDecodingError -> {:error, e}
        end
      end

      @spec json_decode!(iodata(), keyword()) :: struct() | no_return()
      def json_decode!(input, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :decode)

        Protox.JsonDecode.decode!(
          input,
          Electric.Postgres.Schema.Proto.Table,
          &json_library_wrapper.decode!(json_library, &1)
        )
      end

      @spec json_encode(struct(), keyword()) :: {:ok, iodata()} | {:error, any()}
      def json_encode(msg, opts \\ []) do
        try do
          {:ok, json_encode!(msg, opts)}
        rescue
          e in Protox.JsonEncodingError -> {:error, e}
        end
      end

      @spec json_encode!(struct(), keyword()) :: iodata() | no_return()
      def json_encode!(msg, opts \\ []) do
        {json_library_wrapper, json_library} = Protox.JsonLibrary.get_library(opts, :encode)
        Protox.JsonEncode.encode!(msg, &json_library_wrapper.encode!(json_library, &1))
      end
    )

    (
      @deprecated "Use fields_defs()/0 instead"
      @spec defs() :: %{
              required(non_neg_integer) => {atom, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs() do
        %{
          1 => {:name, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.RangeVar}},
          2 => {:columns, :unpacked, {:message, Electric.Postgres.Schema.Proto.Column}},
          3 => {:constraints, :unpacked, {:message, Electric.Postgres.Schema.Proto.Constraint}},
          4 => {:indexes, :unpacked, {:message, Electric.Postgres.Schema.Proto.Index}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          columns: {2, :unpacked, {:message, Electric.Postgres.Schema.Proto.Column}},
          constraints: {3, :unpacked, {:message, Electric.Postgres.Schema.Proto.Constraint}},
          indexes: {4, :unpacked, {:message, Electric.Postgres.Schema.Proto.Index}},
          name: {1, {:scalar, nil}, {:message, Electric.Postgres.Schema.Proto.RangeVar}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "name",
            kind: {:scalar, nil},
            label: :optional,
            name: :name,
            tag: 1,
            type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
          },
          %{
            __struct__: Protox.Field,
            json_name: "columns",
            kind: :unpacked,
            label: :repeated,
            name: :columns,
            tag: 2,
            type: {:message, Electric.Postgres.Schema.Proto.Column}
          },
          %{
            __struct__: Protox.Field,
            json_name: "constraints",
            kind: :unpacked,
            label: :repeated,
            name: :constraints,
            tag: 3,
            type: {:message, Electric.Postgres.Schema.Proto.Constraint}
          },
          %{
            __struct__: Protox.Field,
            json_name: "indexes",
            kind: :unpacked,
            label: :repeated,
            name: :indexes,
            tag: 4,
            type: {:message, Electric.Postgres.Schema.Proto.Index}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, nil},
               label: :optional,
               name: :name,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
             }}
          end

          def field_def("name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "name",
               kind: {:scalar, nil},
               label: :optional,
               name: :name,
               tag: 1,
               type: {:message, Electric.Postgres.Schema.Proto.RangeVar}
             }}
          end

          []
        ),
        (
          def field_def(:columns) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "columns",
               kind: :unpacked,
               label: :repeated,
               name: :columns,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Column}
             }}
          end

          def field_def("columns") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "columns",
               kind: :unpacked,
               label: :repeated,
               name: :columns,
               tag: 2,
               type: {:message, Electric.Postgres.Schema.Proto.Column}
             }}
          end

          []
        ),
        (
          def field_def(:constraints) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "constraints",
               kind: :unpacked,
               label: :repeated,
               name: :constraints,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint}
             }}
          end

          def field_def("constraints") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "constraints",
               kind: :unpacked,
               label: :repeated,
               name: :constraints,
               tag: 3,
               type: {:message, Electric.Postgres.Schema.Proto.Constraint}
             }}
          end

          []
        ),
        (
          def field_def(:indexes) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "indexes",
               kind: :unpacked,
               label: :repeated,
               name: :indexes,
               tag: 4,
               type: {:message, Electric.Postgres.Schema.Proto.Index}
             }}
          end

          def field_def("indexes") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "indexes",
               kind: :unpacked,
               label: :repeated,
               name: :indexes,
               tag: 4,
               type: {:message, Electric.Postgres.Schema.Proto.Index}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    []

    (
      @spec required_fields() :: []
      def required_fields() do
        []
      end
    )

    (
      @spec syntax() :: atom()
      def syntax() do
        :proto3
      end
    )

    [
      @spec(default(atom) :: {:ok, boolean | integer | String.t() | float} | {:error, atom}),
      def default(:name) do
        {:ok, nil}
      end,
      def default(:columns) do
        {:error, :no_default_value}
      end,
      def default(:constraints) do
        {:error, :no_default_value}
      end,
      def default(:indexes) do
        {:error, :no_default_value}
      end,
      def default(_) do
        {:error, :no_such_field}
      end
    ]

    (
      @spec file_options() :: nil
      def file_options() do
        nil
      end
    )
  end
]
