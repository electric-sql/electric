# credo:disable-for-this-file
[
  defmodule Electric.Satellite.V12.SatAuthHeader do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :UNSPECIFIED
        def default() do
          :UNSPECIFIED
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:UNSPECIFIED) do
            0
          end

          def encode("UNSPECIFIED") do
            0
          end
        ),
        (
          def encode(:PROTO_VERSION) do
            1
          end

          def encode("PROTO_VERSION") do
            1
          end
        ),
        (
          def encode(:SCHEMA_VERSION) do
            2
          end

          def encode("SCHEMA_VERSION") do
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
          :UNSPECIFIED
        end,
        def decode(1) do
          :PROTO_VERSION
        end,
        def decode(2) do
          :SCHEMA_VERSION
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :UNSPECIFIED}, {1, :PROTO_VERSION}, {2, :SCHEMA_VERSION}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:UNSPECIFIED) do
            true
          end,
          def has_constant?(:PROTO_VERSION) do
            true
          end,
          def has_constant?(:SCHEMA_VERSION) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Satellite.V12.SatErrorResp.ErrorCode do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :INTERNAL
        def default() do
          :INTERNAL
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:INTERNAL) do
            0
          end

          def encode("INTERNAL") do
            0
          end
        ),
        (
          def encode(:AUTH_REQUIRED) do
            1
          end

          def encode("AUTH_REQUIRED") do
            1
          end
        ),
        (
          def encode(:AUTH_FAILED) do
            2
          end

          def encode("AUTH_FAILED") do
            2
          end
        ),
        (
          def encode(:REPLICATION_FAILED) do
            3
          end

          def encode("REPLICATION_FAILED") do
            3
          end
        ),
        (
          def encode(:INVALID_REQUEST) do
            4
          end

          def encode("INVALID_REQUEST") do
            4
          end
        ),
        (
          def encode(:PROTO_VSN_MISSMATCH) do
            5
          end

          def encode("PROTO_VSN_MISSMATCH") do
            5
          end
        ),
        (
          def encode(:SCHEMA_VSN_MISSMATCH) do
            6
          end

          def encode("SCHEMA_VSN_MISSMATCH") do
            6
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :INTERNAL
        end,
        def decode(1) do
          :AUTH_REQUIRED
        end,
        def decode(2) do
          :AUTH_FAILED
        end,
        def decode(3) do
          :REPLICATION_FAILED
        end,
        def decode(4) do
          :INVALID_REQUEST
        end,
        def decode(5) do
          :PROTO_VSN_MISSMATCH
        end,
        def decode(6) do
          :SCHEMA_VSN_MISSMATCH
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [
          {0, :INTERNAL},
          {1, :AUTH_REQUIRED},
          {2, :AUTH_FAILED},
          {3, :REPLICATION_FAILED},
          {4, :INVALID_REQUEST},
          {5, :PROTO_VSN_MISSMATCH},
          {6, :SCHEMA_VSN_MISSMATCH}
        ]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:INTERNAL) do
            true
          end,
          def has_constant?(:AUTH_REQUIRED) do
            true
          end,
          def has_constant?(:AUTH_FAILED) do
            true
          end,
          def has_constant?(:REPLICATION_FAILED) do
            true
          end,
          def has_constant?(:INVALID_REQUEST) do
            true
          end,
          def has_constant?(:PROTO_VSN_MISSMATCH) do
            true
          end,
          def has_constant?(:SCHEMA_VSN_MISSMATCH) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Satellite.V12.SatInStartReplicationReq.Option do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :NONE
        def default() do
          :NONE
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:NONE) do
            0
          end

          def encode("NONE") do
            0
          end
        ),
        (
          def encode(:LAST_ACKNOWLEDGED) do
            1
          end

          def encode("LAST_ACKNOWLEDGED") do
            1
          end
        ),
        (
          def encode(:SYNC_MODE) do
            2
          end

          def encode("SYNC_MODE") do
            2
          end
        ),
        (
          def encode(:FIRST_LSN) do
            3
          end

          def encode("FIRST_LSN") do
            3
          end
        ),
        (
          def encode(:LAST_LSN) do
            4
          end

          def encode("LAST_LSN") do
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
          :NONE
        end,
        def decode(1) do
          :LAST_ACKNOWLEDGED
        end,
        def decode(2) do
          :SYNC_MODE
        end,
        def decode(3) do
          :FIRST_LSN
        end,
        def decode(4) do
          :LAST_LSN
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :NONE}, {1, :LAST_ACKNOWLEDGED}, {2, :SYNC_MODE}, {3, :FIRST_LSN}, {4, :LAST_LSN}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:NONE) do
            true
          end,
          def has_constant?(:LAST_ACKNOWLEDGED) do
            true
          end,
          def has_constant?(:SYNC_MODE) do
            true
          end,
          def has_constant?(:FIRST_LSN) do
            true
          end,
          def has_constant?(:LAST_LSN) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Satellite.V12.SatOpMigrate.Type do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :CREATE_TABLE
        def default() do
          :CREATE_TABLE
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:CREATE_TABLE) do
            0
          end

          def encode("CREATE_TABLE") do
            0
          end
        ),
        (
          def encode(:CREATE_INDEX) do
            1
          end

          def encode("CREATE_INDEX") do
            1
          end
        ),
        (
          def encode(:ALTER_ADD_COLUMN) do
            6
          end

          def encode("ALTER_ADD_COLUMN") do
            6
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :CREATE_TABLE
        end,
        def decode(1) do
          :CREATE_INDEX
        end,
        def decode(6) do
          :ALTER_ADD_COLUMN
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :CREATE_TABLE}, {1, :CREATE_INDEX}, {6, :ALTER_ADD_COLUMN}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:CREATE_TABLE) do
            true
          end,
          def has_constant?(:CREATE_INDEX) do
            true
          end,
          def has_constant?(:ALTER_ADD_COLUMN) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Satellite.V12.SatRelation.RelationType do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :TABLE
        def default() do
          :TABLE
        end
      )

      @spec encode(atom() | String.t()) :: integer() | atom()
      [
        (
          def encode(:TABLE) do
            0
          end

          def encode("TABLE") do
            0
          end
        ),
        (
          def encode(:INDEX) do
            1
          end

          def encode("INDEX") do
            1
          end
        ),
        (
          def encode(:VIEW) do
            2
          end

          def encode("VIEW") do
            2
          end
        ),
        (
          def encode(:TRIGGER) do
            3
          end

          def encode("TRIGGER") do
            3
          end
        )
      ]

      def encode(x) do
        x
      end

      @spec decode(integer()) :: atom() | integer()
      [
        def decode(0) do
          :TABLE
        end,
        def decode(1) do
          :INDEX
        end,
        def decode(2) do
          :VIEW
        end,
        def decode(3) do
          :TRIGGER
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :TABLE}, {1, :INDEX}, {2, :VIEW}, {3, :TRIGGER}]
      end

      @spec has_constant?(any()) :: boolean()
      (
        [
          def has_constant?(:TABLE) do
            true
          end,
          def has_constant?(:INDEX) do
            true
          end,
          def has_constant?(:VIEW) do
            true
          end,
          def has_constant?(:TRIGGER) do
            true
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Satellite.V12.SatAuthHeaderPair do
    @moduledoc false
    defstruct key: :UNSPECIFIED, value: "", __uf__: []

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
          [] |> encode_key(msg) |> encode_value(msg) |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_key(acc, msg) do
          try do
            if msg.key == :UNSPECIFIED do
              acc
            else
              [
                acc,
                "\b",
                msg.key
                |> Electric.Satellite.V12.SatAuthHeader.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:key, "invalid field value"), __STACKTRACE__
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

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatAuthHeaderPair))
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
                  Protox.Decode.parse_enum(bytes, Electric.Satellite.V12.SatAuthHeader)

                {[key: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[value: delimited], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatAuthHeaderPair,
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
          1 => {:key, {:scalar, :UNSPECIFIED}, {:enum, Electric.Satellite.V12.SatAuthHeader}},
          2 => {:value, {:scalar, ""}, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          key: {1, {:scalar, :UNSPECIFIED}, {:enum, Electric.Satellite.V12.SatAuthHeader}},
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
            json_name: "key",
            kind: {:scalar, :UNSPECIFIED},
            label: :optional,
            name: :key,
            tag: 1,
            type: {:enum, Electric.Satellite.V12.SatAuthHeader}
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
          def field_def(:key) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "key",
               kind: {:scalar, :UNSPECIFIED},
               label: :optional,
               name: :key,
               tag: 1,
               type: {:enum, Electric.Satellite.V12.SatAuthHeader}
             }}
          end

          def field_def("key") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "key",
               kind: {:scalar, :UNSPECIFIED},
               label: :optional,
               name: :key,
               tag: 1,
               type: {:enum, Electric.Satellite.V12.SatAuthHeader}
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

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:key) do
        {:ok, :UNSPECIFIED}
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
  defmodule Electric.Satellite.V12.SatAuthReq do
    @moduledoc false
    defstruct id: "", token: "", headers: [], __uf__: []

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
          |> encode_id(msg)
          |> encode_token(msg)
          |> encode_headers(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_id(acc, msg) do
          try do
            if msg.id == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.id)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:id, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_token(acc, msg) do
          try do
            if msg.token == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.token)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:token, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_headers(acc, msg) do
          try do
            case msg.headers do
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
              reraise Protox.EncodingError.new(:headers, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatAuthReq))
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
                {[id: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[token: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   headers:
                     msg.headers ++ [Electric.Satellite.V12.SatAuthHeaderPair.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatAuthReq,
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
          1 => {:id, {:scalar, ""}, :string},
          2 => {:token, {:scalar, ""}, :string},
          3 => {:headers, :unpacked, {:message, Electric.Satellite.V12.SatAuthHeaderPair}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          headers: {3, :unpacked, {:message, Electric.Satellite.V12.SatAuthHeaderPair}},
          id: {1, {:scalar, ""}, :string},
          token: {2, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "id",
            kind: {:scalar, ""},
            label: :optional,
            name: :id,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "token",
            kind: {:scalar, ""},
            label: :optional,
            name: :token,
            tag: 2,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "headers",
            kind: :unpacked,
            label: :repeated,
            name: :headers,
            tag: 3,
            type: {:message, Electric.Satellite.V12.SatAuthHeaderPair}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:id) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "id",
               kind: {:scalar, ""},
               label: :optional,
               name: :id,
               tag: 1,
               type: :string
             }}
          end

          def field_def("id") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "id",
               kind: {:scalar, ""},
               label: :optional,
               name: :id,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:token) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "token",
               kind: {:scalar, ""},
               label: :optional,
               name: :token,
               tag: 2,
               type: :string
             }}
          end

          def field_def("token") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "token",
               kind: {:scalar, ""},
               label: :optional,
               name: :token,
               tag: 2,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:headers) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "headers",
               kind: :unpacked,
               label: :repeated,
               name: :headers,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatAuthHeaderPair}
             }}
          end

          def field_def("headers") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "headers",
               kind: :unpacked,
               label: :repeated,
               name: :headers,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatAuthHeaderPair}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:id) do
        {:ok, ""}
      end,
      def default(:token) do
        {:ok, ""}
      end,
      def default(:headers) do
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
  defmodule Electric.Satellite.V12.SatAuthResp do
    @moduledoc false
    defstruct id: "", headers: [], __uf__: []

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
          [] |> encode_id(msg) |> encode_headers(msg) |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_id(acc, msg) do
          try do
            if msg.id == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.id)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:id, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_headers(acc, msg) do
          try do
            case msg.headers do
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
              reraise Protox.EncodingError.new(:headers, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatAuthResp))
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
                {[id: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   headers:
                     msg.headers ++ [Electric.Satellite.V12.SatAuthHeaderPair.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatAuthResp,
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
          1 => {:id, {:scalar, ""}, :string},
          3 => {:headers, :unpacked, {:message, Electric.Satellite.V12.SatAuthHeaderPair}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          headers: {3, :unpacked, {:message, Electric.Satellite.V12.SatAuthHeaderPair}},
          id: {1, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "id",
            kind: {:scalar, ""},
            label: :optional,
            name: :id,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "headers",
            kind: :unpacked,
            label: :repeated,
            name: :headers,
            tag: 3,
            type: {:message, Electric.Satellite.V12.SatAuthHeaderPair}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:id) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "id",
               kind: {:scalar, ""},
               label: :optional,
               name: :id,
               tag: 1,
               type: :string
             }}
          end

          def field_def("id") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "id",
               kind: {:scalar, ""},
               label: :optional,
               name: :id,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:headers) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "headers",
               kind: :unpacked,
               label: :repeated,
               name: :headers,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatAuthHeaderPair}
             }}
          end

          def field_def("headers") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "headers",
               kind: :unpacked,
               label: :repeated,
               name: :headers,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatAuthHeaderPair}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:id) do
        {:ok, ""}
      end,
      def default(:headers) do
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
  defmodule Electric.Satellite.V12.SatErrorResp do
    @moduledoc false
    defstruct error_type: :INTERNAL, __uf__: []

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
          [] |> encode_error_type(msg) |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_error_type(acc, msg) do
          try do
            if msg.error_type == :INTERNAL do
              acc
            else
              [
                acc,
                "\b",
                msg.error_type
                |> Electric.Satellite.V12.SatErrorResp.ErrorCode.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:error_type, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatErrorResp))
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
                  Protox.Decode.parse_enum(bytes, Electric.Satellite.V12.SatErrorResp.ErrorCode)

                {[error_type: value], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatErrorResp,
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
            {:error_type, {:scalar, :INTERNAL},
             {:enum, Electric.Satellite.V12.SatErrorResp.ErrorCode}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          error_type:
            {1, {:scalar, :INTERNAL}, {:enum, Electric.Satellite.V12.SatErrorResp.ErrorCode}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "errorType",
            kind: {:scalar, :INTERNAL},
            label: :optional,
            name: :error_type,
            tag: 1,
            type: {:enum, Electric.Satellite.V12.SatErrorResp.ErrorCode}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:error_type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "errorType",
               kind: {:scalar, :INTERNAL},
               label: :optional,
               name: :error_type,
               tag: 1,
               type: {:enum, Electric.Satellite.V12.SatErrorResp.ErrorCode}
             }}
          end

          def field_def("errorType") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "errorType",
               kind: {:scalar, :INTERNAL},
               label: :optional,
               name: :error_type,
               tag: 1,
               type: {:enum, Electric.Satellite.V12.SatErrorResp.ErrorCode}
             }}
          end

          def field_def("error_type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "errorType",
               kind: {:scalar, :INTERNAL},
               label: :optional,
               name: :error_type,
               tag: 1,
               type: {:enum, Electric.Satellite.V12.SatErrorResp.ErrorCode}
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:error_type) do
        {:ok, :INTERNAL}
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
  defmodule Electric.Satellite.V12.SatInStartReplicationReq do
    @moduledoc false
    defstruct lsn: "", options: [], sync_batch_size: 0, __uf__: []

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
          |> encode_lsn(msg)
          |> encode_options(msg)
          |> encode_sync_batch_size(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_lsn(acc, msg) do
          try do
            if msg.lsn == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_bytes(msg.lsn)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:lsn, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_options(acc, msg) do
          try do
            case msg.options do
              [] ->
                acc

              values ->
                [
                  acc,
                  "\x12",
                  (
                    {bytes, len} =
                      Enum.reduce(values, {[], 0}, fn value, {acc, len} ->
                        value_bytes =
                          :binary.list_to_bin([
                            value
                            |> Electric.Satellite.V12.SatInStartReplicationReq.Option.encode()
                            |> Protox.Encode.encode_enum()
                          ])

                        {[acc, value_bytes], len + byte_size(value_bytes)}
                      end)

                    [Protox.Varint.encode(len), bytes]
                  )
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:options, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_sync_batch_size(acc, msg) do
          try do
            if msg.sync_batch_size == 0 do
              acc
            else
              [acc, "\x18", Protox.Encode.encode_int32(msg.sync_batch_size)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:sync_batch_size, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatInStartReplicationReq))
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
                {[lsn: delimited], rest}

              {2, 2, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   options:
                     msg.options ++
                       Protox.Decode.parse_repeated_enum(
                         [],
                         delimited,
                         Electric.Satellite.V12.SatInStartReplicationReq.Option
                       )
                 ], rest}

              {2, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Satellite.V12.SatInStartReplicationReq.Option
                  )

                {[options: msg.options ++ [value]], rest}

              {3, _, bytes} ->
                {value, rest} = Protox.Decode.parse_int32(bytes)
                {[sync_batch_size: value], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatInStartReplicationReq,
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
          1 => {:lsn, {:scalar, ""}, :bytes},
          2 =>
            {:options, :packed, {:enum, Electric.Satellite.V12.SatInStartReplicationReq.Option}},
          3 => {:sync_batch_size, {:scalar, 0}, :int32}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          lsn: {1, {:scalar, ""}, :bytes},
          options: {2, :packed, {:enum, Electric.Satellite.V12.SatInStartReplicationReq.Option}},
          sync_batch_size: {3, {:scalar, 0}, :int32}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "lsn",
            kind: {:scalar, ""},
            label: :optional,
            name: :lsn,
            tag: 1,
            type: :bytes
          },
          %{
            __struct__: Protox.Field,
            json_name: "options",
            kind: :packed,
            label: :repeated,
            name: :options,
            tag: 2,
            type: {:enum, Electric.Satellite.V12.SatInStartReplicationReq.Option}
          },
          %{
            __struct__: Protox.Field,
            json_name: "syncBatchSize",
            kind: {:scalar, 0},
            label: :optional,
            name: :sync_batch_size,
            tag: 3,
            type: :int32
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:lsn) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "lsn",
               kind: {:scalar, ""},
               label: :optional,
               name: :lsn,
               tag: 1,
               type: :bytes
             }}
          end

          def field_def("lsn") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "lsn",
               kind: {:scalar, ""},
               label: :optional,
               name: :lsn,
               tag: 1,
               type: :bytes
             }}
          end

          []
        ),
        (
          def field_def(:options) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "options",
               kind: :packed,
               label: :repeated,
               name: :options,
               tag: 2,
               type: {:enum, Electric.Satellite.V12.SatInStartReplicationReq.Option}
             }}
          end

          def field_def("options") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "options",
               kind: :packed,
               label: :repeated,
               name: :options,
               tag: 2,
               type: {:enum, Electric.Satellite.V12.SatInStartReplicationReq.Option}
             }}
          end

          []
        ),
        (
          def field_def(:sync_batch_size) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "syncBatchSize",
               kind: {:scalar, 0},
               label: :optional,
               name: :sync_batch_size,
               tag: 3,
               type: :int32
             }}
          end

          def field_def("syncBatchSize") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "syncBatchSize",
               kind: {:scalar, 0},
               label: :optional,
               name: :sync_batch_size,
               tag: 3,
               type: :int32
             }}
          end

          def field_def("sync_batch_size") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "syncBatchSize",
               kind: {:scalar, 0},
               label: :optional,
               name: :sync_batch_size,
               tag: 3,
               type: :int32
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:lsn) do
        {:ok, ""}
      end,
      def default(:options) do
        {:error, :no_default_value}
      end,
      def default(:sync_batch_size) do
        {:ok, 0}
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
  defmodule Electric.Satellite.V12.SatInStartReplicationResp do
    @moduledoc false
    defstruct __uf__: []

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
          [] |> encode_unknown_fields(msg)
        end
      )

      []
      []

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatInStartReplicationResp))
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

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatInStartReplicationResp,
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
        %{}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        []
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
  defmodule Electric.Satellite.V12.SatInStopReplicationReq do
    @moduledoc false
    defstruct __uf__: []

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
          [] |> encode_unknown_fields(msg)
        end
      )

      []
      []

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatInStopReplicationReq))
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

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatInStopReplicationReq,
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
        %{}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        []
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
  defmodule Electric.Satellite.V12.SatInStopReplicationResp do
    @moduledoc false
    defstruct __uf__: []

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
          [] |> encode_unknown_fields(msg)
        end
      )

      []
      []

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatInStopReplicationResp))
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

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatInStopReplicationResp,
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
        %{}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        []
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
  defmodule Electric.Satellite.V12.SatMigrationNotification do
    @moduledoc false
    defstruct old_schema_version: "",
              old_schema_hash: "",
              new_schema_version: "",
              new_schema_hash: "",
              __uf__: []

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
          |> encode_old_schema_version(msg)
          |> encode_old_schema_hash(msg)
          |> encode_new_schema_version(msg)
          |> encode_new_schema_hash(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_old_schema_version(acc, msg) do
          try do
            if msg.old_schema_version == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.old_schema_version)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:old_schema_version, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_old_schema_hash(acc, msg) do
          try do
            if msg.old_schema_hash == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.old_schema_hash)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:old_schema_hash, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_new_schema_version(acc, msg) do
          try do
            if msg.new_schema_version == "" do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_string(msg.new_schema_version)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:new_schema_version, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_new_schema_hash(acc, msg) do
          try do
            if msg.new_schema_hash == "" do
              acc
            else
              [acc, "\"", Protox.Encode.encode_string(msg.new_schema_hash)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:new_schema_hash, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatMigrationNotification))
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
                {[old_schema_version: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[old_schema_hash: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[new_schema_version: delimited], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[new_schema_hash: delimited], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatMigrationNotification,
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
          1 => {:old_schema_version, {:scalar, ""}, :string},
          2 => {:old_schema_hash, {:scalar, ""}, :string},
          3 => {:new_schema_version, {:scalar, ""}, :string},
          4 => {:new_schema_hash, {:scalar, ""}, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          new_schema_hash: {4, {:scalar, ""}, :string},
          new_schema_version: {3, {:scalar, ""}, :string},
          old_schema_hash: {2, {:scalar, ""}, :string},
          old_schema_version: {1, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "oldSchemaVersion",
            kind: {:scalar, ""},
            label: :optional,
            name: :old_schema_version,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "oldSchemaHash",
            kind: {:scalar, ""},
            label: :optional,
            name: :old_schema_hash,
            tag: 2,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "newSchemaVersion",
            kind: {:scalar, ""},
            label: :optional,
            name: :new_schema_version,
            tag: 3,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "newSchemaHash",
            kind: {:scalar, ""},
            label: :optional,
            name: :new_schema_hash,
            tag: 4,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:old_schema_version) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldSchemaVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :old_schema_version,
               tag: 1,
               type: :string
             }}
          end

          def field_def("oldSchemaVersion") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldSchemaVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :old_schema_version,
               tag: 1,
               type: :string
             }}
          end

          def field_def("old_schema_version") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldSchemaVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :old_schema_version,
               tag: 1,
               type: :string
             }}
          end
        ),
        (
          def field_def(:old_schema_hash) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldSchemaHash",
               kind: {:scalar, ""},
               label: :optional,
               name: :old_schema_hash,
               tag: 2,
               type: :string
             }}
          end

          def field_def("oldSchemaHash") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldSchemaHash",
               kind: {:scalar, ""},
               label: :optional,
               name: :old_schema_hash,
               tag: 2,
               type: :string
             }}
          end

          def field_def("old_schema_hash") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldSchemaHash",
               kind: {:scalar, ""},
               label: :optional,
               name: :old_schema_hash,
               tag: 2,
               type: :string
             }}
          end
        ),
        (
          def field_def(:new_schema_version) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "newSchemaVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :new_schema_version,
               tag: 3,
               type: :string
             }}
          end

          def field_def("newSchemaVersion") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "newSchemaVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :new_schema_version,
               tag: 3,
               type: :string
             }}
          end

          def field_def("new_schema_version") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "newSchemaVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :new_schema_version,
               tag: 3,
               type: :string
             }}
          end
        ),
        (
          def field_def(:new_schema_hash) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "newSchemaHash",
               kind: {:scalar, ""},
               label: :optional,
               name: :new_schema_hash,
               tag: 4,
               type: :string
             }}
          end

          def field_def("newSchemaHash") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "newSchemaHash",
               kind: {:scalar, ""},
               label: :optional,
               name: :new_schema_hash,
               tag: 4,
               type: :string
             }}
          end

          def field_def("new_schema_hash") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "newSchemaHash",
               kind: {:scalar, ""},
               label: :optional,
               name: :new_schema_hash,
               tag: 4,
               type: :string
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:old_schema_version) do
        {:ok, ""}
      end,
      def default(:old_schema_hash) do
        {:ok, ""}
      end,
      def default(:new_schema_version) do
        {:ok, ""}
      end,
      def default(:new_schema_hash) do
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
  defmodule Electric.Satellite.V12.SatOpBegin do
    @moduledoc false
    defstruct commit_timestamp: 0,
              trans_id: "",
              lsn: "",
              origin: nil,
              is_migration: false,
              __uf__: []

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
          |> encode_origin(msg)
          |> encode_commit_timestamp(msg)
          |> encode_trans_id(msg)
          |> encode_lsn(msg)
          |> encode_is_migration(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_commit_timestamp(acc, msg) do
          try do
            if msg.commit_timestamp == 0 do
              acc
            else
              [acc, "\b", Protox.Encode.encode_uint64(msg.commit_timestamp)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:commit_timestamp, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_trans_id(acc, msg) do
          try do
            if msg.trans_id == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.trans_id)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:trans_id, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_lsn(acc, msg) do
          try do
            if msg.lsn == "" do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_bytes(msg.lsn)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:lsn, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_origin(acc, msg) do
          try do
            case msg.origin do
              nil -> [acc]
              child_field_value -> [acc, "\"", Protox.Encode.encode_string(child_field_value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:origin, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_is_migration(acc, msg) do
          try do
            if msg.is_migration == false do
              acc
            else
              [acc, "(", Protox.Encode.encode_bool(msg.is_migration)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:is_migration, "invalid field value"),
                      __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpBegin))
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
                {value, rest} = Protox.Decode.parse_uint64(bytes)
                {[commit_timestamp: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[trans_id: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[lsn: delimited], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[origin: delimited], rest}

              {5, _, bytes} ->
                {value, rest} = Protox.Decode.parse_bool(bytes)
                {[is_migration: value], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpBegin,
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
          1 => {:commit_timestamp, {:scalar, 0}, :uint64},
          2 => {:trans_id, {:scalar, ""}, :string},
          3 => {:lsn, {:scalar, ""}, :bytes},
          4 => {:origin, {:oneof, :_origin}, :string},
          5 => {:is_migration, {:scalar, false}, :bool}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          commit_timestamp: {1, {:scalar, 0}, :uint64},
          is_migration: {5, {:scalar, false}, :bool},
          lsn: {3, {:scalar, ""}, :bytes},
          origin: {4, {:oneof, :_origin}, :string},
          trans_id: {2, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "commitTimestamp",
            kind: {:scalar, 0},
            label: :optional,
            name: :commit_timestamp,
            tag: 1,
            type: :uint64
          },
          %{
            __struct__: Protox.Field,
            json_name: "transId",
            kind: {:scalar, ""},
            label: :optional,
            name: :trans_id,
            tag: 2,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "lsn",
            kind: {:scalar, ""},
            label: :optional,
            name: :lsn,
            tag: 3,
            type: :bytes
          },
          %{
            __struct__: Protox.Field,
            json_name: "origin",
            kind: {:oneof, :_origin},
            label: :proto3_optional,
            name: :origin,
            tag: 4,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "isMigration",
            kind: {:scalar, false},
            label: :optional,
            name: :is_migration,
            tag: 5,
            type: :bool
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:commit_timestamp) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "commitTimestamp",
               kind: {:scalar, 0},
               label: :optional,
               name: :commit_timestamp,
               tag: 1,
               type: :uint64
             }}
          end

          def field_def("commitTimestamp") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "commitTimestamp",
               kind: {:scalar, 0},
               label: :optional,
               name: :commit_timestamp,
               tag: 1,
               type: :uint64
             }}
          end

          def field_def("commit_timestamp") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "commitTimestamp",
               kind: {:scalar, 0},
               label: :optional,
               name: :commit_timestamp,
               tag: 1,
               type: :uint64
             }}
          end
        ),
        (
          def field_def(:trans_id) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "transId",
               kind: {:scalar, ""},
               label: :optional,
               name: :trans_id,
               tag: 2,
               type: :string
             }}
          end

          def field_def("transId") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "transId",
               kind: {:scalar, ""},
               label: :optional,
               name: :trans_id,
               tag: 2,
               type: :string
             }}
          end

          def field_def("trans_id") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "transId",
               kind: {:scalar, ""},
               label: :optional,
               name: :trans_id,
               tag: 2,
               type: :string
             }}
          end
        ),
        (
          def field_def(:lsn) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "lsn",
               kind: {:scalar, ""},
               label: :optional,
               name: :lsn,
               tag: 3,
               type: :bytes
             }}
          end

          def field_def("lsn") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "lsn",
               kind: {:scalar, ""},
               label: :optional,
               name: :lsn,
               tag: 3,
               type: :bytes
             }}
          end

          []
        ),
        (
          def field_def(:origin) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "origin",
               kind: {:oneof, :_origin},
               label: :proto3_optional,
               name: :origin,
               tag: 4,
               type: :string
             }}
          end

          def field_def("origin") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "origin",
               kind: {:oneof, :_origin},
               label: :proto3_optional,
               name: :origin,
               tag: 4,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:is_migration) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "isMigration",
               kind: {:scalar, false},
               label: :optional,
               name: :is_migration,
               tag: 5,
               type: :bool
             }}
          end

          def field_def("isMigration") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "isMigration",
               kind: {:scalar, false},
               label: :optional,
               name: :is_migration,
               tag: 5,
               type: :bool
             }}
          end

          def field_def("is_migration") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "isMigration",
               kind: {:scalar, false},
               label: :optional,
               name: :is_migration,
               tag: 5,
               type: :bool
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:commit_timestamp) do
        {:ok, 0}
      end,
      def default(:trans_id) do
        {:ok, ""}
      end,
      def default(:lsn) do
        {:ok, ""}
      end,
      def default(:origin) do
        {:error, :no_default_value}
      end,
      def default(:is_migration) do
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
  defmodule Electric.Satellite.V12.SatOpCommit do
    @moduledoc false
    defstruct commit_timestamp: 0, trans_id: "", lsn: "", __uf__: []

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
          |> encode_commit_timestamp(msg)
          |> encode_trans_id(msg)
          |> encode_lsn(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_commit_timestamp(acc, msg) do
          try do
            if msg.commit_timestamp == 0 do
              acc
            else
              [acc, "\b", Protox.Encode.encode_uint64(msg.commit_timestamp)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:commit_timestamp, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_trans_id(acc, msg) do
          try do
            if msg.trans_id == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.trans_id)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:trans_id, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_lsn(acc, msg) do
          try do
            if msg.lsn == "" do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_bytes(msg.lsn)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:lsn, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpCommit))
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
                {value, rest} = Protox.Decode.parse_uint64(bytes)
                {[commit_timestamp: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[trans_id: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[lsn: delimited], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpCommit,
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
          1 => {:commit_timestamp, {:scalar, 0}, :uint64},
          2 => {:trans_id, {:scalar, ""}, :string},
          3 => {:lsn, {:scalar, ""}, :bytes}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          commit_timestamp: {1, {:scalar, 0}, :uint64},
          lsn: {3, {:scalar, ""}, :bytes},
          trans_id: {2, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "commitTimestamp",
            kind: {:scalar, 0},
            label: :optional,
            name: :commit_timestamp,
            tag: 1,
            type: :uint64
          },
          %{
            __struct__: Protox.Field,
            json_name: "transId",
            kind: {:scalar, ""},
            label: :optional,
            name: :trans_id,
            tag: 2,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "lsn",
            kind: {:scalar, ""},
            label: :optional,
            name: :lsn,
            tag: 3,
            type: :bytes
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:commit_timestamp) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "commitTimestamp",
               kind: {:scalar, 0},
               label: :optional,
               name: :commit_timestamp,
               tag: 1,
               type: :uint64
             }}
          end

          def field_def("commitTimestamp") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "commitTimestamp",
               kind: {:scalar, 0},
               label: :optional,
               name: :commit_timestamp,
               tag: 1,
               type: :uint64
             }}
          end

          def field_def("commit_timestamp") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "commitTimestamp",
               kind: {:scalar, 0},
               label: :optional,
               name: :commit_timestamp,
               tag: 1,
               type: :uint64
             }}
          end
        ),
        (
          def field_def(:trans_id) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "transId",
               kind: {:scalar, ""},
               label: :optional,
               name: :trans_id,
               tag: 2,
               type: :string
             }}
          end

          def field_def("transId") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "transId",
               kind: {:scalar, ""},
               label: :optional,
               name: :trans_id,
               tag: 2,
               type: :string
             }}
          end

          def field_def("trans_id") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "transId",
               kind: {:scalar, ""},
               label: :optional,
               name: :trans_id,
               tag: 2,
               type: :string
             }}
          end
        ),
        (
          def field_def(:lsn) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "lsn",
               kind: {:scalar, ""},
               label: :optional,
               name: :lsn,
               tag: 3,
               type: :bytes
             }}
          end

          def field_def("lsn") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "lsn",
               kind: {:scalar, ""},
               label: :optional,
               name: :lsn,
               tag: 3,
               type: :bytes
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:commit_timestamp) do
        {:ok, 0}
      end,
      def default(:trans_id) do
        {:ok, ""}
      end,
      def default(:lsn) do
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
  defmodule Electric.Satellite.V12.SatOpDelete do
    @moduledoc false
    defstruct relation_id: 0, old_row_data: nil, tags: [], __uf__: []

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
          |> encode_relation_id(msg)
          |> encode_old_row_data(msg)
          |> encode_tags(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_relation_id(acc, msg) do
          try do
            if msg.relation_id == 0 do
              acc
            else
              [acc, "\b", Protox.Encode.encode_uint32(msg.relation_id)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:relation_id, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_old_row_data(acc, msg) do
          try do
            if msg.old_row_data == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.old_row_data)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:old_row_data, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_tags(acc, msg) do
          try do
            case msg.tags do
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
              reraise Protox.EncodingError.new(:tags, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpDelete))
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
                {value, rest} = Protox.Decode.parse_uint32(bytes)
                {[relation_id: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   old_row_data:
                     Protox.MergeMessage.merge(
                       msg.old_row_data,
                       Electric.Satellite.V12.SatOpRow.decode!(delimited)
                     )
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[tags: msg.tags ++ [delimited]], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpDelete,
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
          1 => {:relation_id, {:scalar, 0}, :uint32},
          2 => {:old_row_data, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpRow}},
          3 => {:tags, :unpacked, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          old_row_data: {2, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpRow}},
          relation_id: {1, {:scalar, 0}, :uint32},
          tags: {3, :unpacked, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "relationId",
            kind: {:scalar, 0},
            label: :optional,
            name: :relation_id,
            tag: 1,
            type: :uint32
          },
          %{
            __struct__: Protox.Field,
            json_name: "oldRowData",
            kind: {:scalar, nil},
            label: :optional,
            name: :old_row_data,
            tag: 2,
            type: {:message, Electric.Satellite.V12.SatOpRow}
          },
          %{
            __struct__: Protox.Field,
            json_name: "tags",
            kind: :unpacked,
            label: :repeated,
            name: :tags,
            tag: 3,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:relation_id) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end

          def field_def("relationId") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end

          def field_def("relation_id") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end
        ),
        (
          def field_def(:old_row_data) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :old_row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end

          def field_def("oldRowData") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :old_row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end

          def field_def("old_row_data") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :old_row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end
        ),
        (
          def field_def(:tags) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tags",
               kind: :unpacked,
               label: :repeated,
               name: :tags,
               tag: 3,
               type: :string
             }}
          end

          def field_def("tags") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tags",
               kind: :unpacked,
               label: :repeated,
               name: :tags,
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

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:relation_id) do
        {:ok, 0}
      end,
      def default(:old_row_data) do
        {:ok, nil}
      end,
      def default(:tags) do
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
  defmodule Electric.Satellite.V12.SatOpInsert do
    @moduledoc false
    defstruct relation_id: 0, row_data: nil, tags: [], __uf__: []

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
          |> encode_relation_id(msg)
          |> encode_row_data(msg)
          |> encode_tags(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_relation_id(acc, msg) do
          try do
            if msg.relation_id == 0 do
              acc
            else
              [acc, "\b", Protox.Encode.encode_uint32(msg.relation_id)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:relation_id, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_row_data(acc, msg) do
          try do
            if msg.row_data == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.row_data)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:row_data, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_tags(acc, msg) do
          try do
            case msg.tags do
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
              reraise Protox.EncodingError.new(:tags, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpInsert))
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
                {value, rest} = Protox.Decode.parse_uint32(bytes)
                {[relation_id: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   row_data:
                     Protox.MergeMessage.merge(
                       msg.row_data,
                       Electric.Satellite.V12.SatOpRow.decode!(delimited)
                     )
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[tags: msg.tags ++ [delimited]], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpInsert,
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
          1 => {:relation_id, {:scalar, 0}, :uint32},
          2 => {:row_data, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpRow}},
          3 => {:tags, :unpacked, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          relation_id: {1, {:scalar, 0}, :uint32},
          row_data: {2, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpRow}},
          tags: {3, :unpacked, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "relationId",
            kind: {:scalar, 0},
            label: :optional,
            name: :relation_id,
            tag: 1,
            type: :uint32
          },
          %{
            __struct__: Protox.Field,
            json_name: "rowData",
            kind: {:scalar, nil},
            label: :optional,
            name: :row_data,
            tag: 2,
            type: {:message, Electric.Satellite.V12.SatOpRow}
          },
          %{
            __struct__: Protox.Field,
            json_name: "tags",
            kind: :unpacked,
            label: :repeated,
            name: :tags,
            tag: 3,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:relation_id) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end

          def field_def("relationId") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end

          def field_def("relation_id") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end
        ),
        (
          def field_def(:row_data) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end

          def field_def("rowData") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end

          def field_def("row_data") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end
        ),
        (
          def field_def(:tags) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tags",
               kind: :unpacked,
               label: :repeated,
               name: :tags,
               tag: 3,
               type: :string
             }}
          end

          def field_def("tags") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tags",
               kind: :unpacked,
               label: :repeated,
               name: :tags,
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

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:relation_id) do
        {:ok, 0}
      end,
      def default(:row_data) do
        {:ok, nil}
      end,
      def default(:tags) do
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
  defmodule Electric.Satellite.V12.SatOpLog do
    @moduledoc false
    defstruct ops: [], __uf__: []

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
          [] |> encode_ops(msg) |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_ops(acc, msg) do
          try do
            case msg.ops do
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
              reraise Protox.EncodingError.new(:ops, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpLog))
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
                {[ops: msg.ops ++ [Electric.Satellite.V12.SatTransOp.decode!(delimited)]], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpLog,
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
        %{1 => {:ops, :unpacked, {:message, Electric.Satellite.V12.SatTransOp}}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{ops: {1, :unpacked, {:message, Electric.Satellite.V12.SatTransOp}}}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "ops",
            kind: :unpacked,
            label: :repeated,
            name: :ops,
            tag: 1,
            type: {:message, Electric.Satellite.V12.SatTransOp}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:ops) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "ops",
               kind: :unpacked,
               label: :repeated,
               name: :ops,
               tag: 1,
               type: {:message, Electric.Satellite.V12.SatTransOp}
             }}
          end

          def field_def("ops") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "ops",
               kind: :unpacked,
               label: :repeated,
               name: :ops,
               tag: 1,
               type: {:message, Electric.Satellite.V12.SatTransOp}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:ops) do
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
  defmodule Electric.Satellite.V12.SatOpMigrate do
    @moduledoc false
    defstruct version: "", stmts: [], table: nil, __uf__: []

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
          |> encode_version(msg)
          |> encode_stmts(msg)
          |> encode_table(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_version(acc, msg) do
          try do
            if msg.version == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.version)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:version, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_stmts(acc, msg) do
          try do
            case msg.stmts do
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
              reraise Protox.EncodingError.new(:stmts, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_table(acc, msg) do
          try do
            if msg.table == nil do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_message(msg.table)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:table, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpMigrate))
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
                {[version: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   stmts:
                     msg.stmts ++ [Electric.Satellite.V12.SatOpMigrate.Stmt.decode!(delimited)]
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   table:
                     Protox.MergeMessage.merge(
                       msg.table,
                       Electric.Satellite.V12.SatOpMigrate.Table.decode!(delimited)
                     )
                 ], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpMigrate,
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
          1 => {:version, {:scalar, ""}, :string},
          2 => {:stmts, :unpacked, {:message, Electric.Satellite.V12.SatOpMigrate.Stmt}},
          3 => {:table, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpMigrate.Table}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          stmts: {2, :unpacked, {:message, Electric.Satellite.V12.SatOpMigrate.Stmt}},
          table: {3, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpMigrate.Table}},
          version: {1, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "version",
            kind: {:scalar, ""},
            label: :optional,
            name: :version,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "stmts",
            kind: :unpacked,
            label: :repeated,
            name: :stmts,
            tag: 2,
            type: {:message, Electric.Satellite.V12.SatOpMigrate.Stmt}
          },
          %{
            __struct__: Protox.Field,
            json_name: "table",
            kind: {:scalar, nil},
            label: :optional,
            name: :table,
            tag: 3,
            type: {:message, Electric.Satellite.V12.SatOpMigrate.Table}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:version) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "version",
               kind: {:scalar, ""},
               label: :optional,
               name: :version,
               tag: 1,
               type: :string
             }}
          end

          def field_def("version") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "version",
               kind: {:scalar, ""},
               label: :optional,
               name: :version,
               tag: 1,
               type: :string
             }}
          end

          []
        ),
        (
          def field_def(:stmts) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "stmts",
               kind: :unpacked,
               label: :repeated,
               name: :stmts,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.Stmt}
             }}
          end

          def field_def("stmts") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "stmts",
               kind: :unpacked,
               label: :repeated,
               name: :stmts,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.Stmt}
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
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.Table}
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
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.Table}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:version) do
        {:ok, ""}
      end,
      def default(:stmts) do
        {:error, :no_default_value}
      end,
      def default(:table) do
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
  defmodule Electric.Satellite.V12.SatOpMigrate.Column do
    @moduledoc false
    defstruct name: "", sqlite_type: "", pg_type: nil, __uf__: []

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
          |> encode_sqlite_type(msg)
          |> encode_pg_type(msg)
          |> encode_unknown_fields(msg)
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
        defp encode_sqlite_type(acc, msg) do
          try do
            if msg.sqlite_type == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.sqlite_type)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:sqlite_type, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_pg_type(acc, msg) do
          try do
            if msg.pg_type == nil do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_message(msg.pg_type)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:pg_type, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpMigrate.Column))
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
                {[sqlite_type: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   pg_type:
                     Protox.MergeMessage.merge(
                       msg.pg_type,
                       Electric.Satellite.V12.SatOpMigrate.PgColumnType.decode!(delimited)
                     )
                 ], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpMigrate.Column,
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
          2 => {:sqlite_type, {:scalar, ""}, :string},
          3 =>
            {:pg_type, {:scalar, nil},
             {:message, Electric.Satellite.V12.SatOpMigrate.PgColumnType}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          name: {1, {:scalar, ""}, :string},
          pg_type:
            {3, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpMigrate.PgColumnType}},
          sqlite_type: {2, {:scalar, ""}, :string}
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
            json_name: "sqliteType",
            kind: {:scalar, ""},
            label: :optional,
            name: :sqlite_type,
            tag: 2,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "pgType",
            kind: {:scalar, nil},
            label: :optional,
            name: :pg_type,
            tag: 3,
            type: {:message, Electric.Satellite.V12.SatOpMigrate.PgColumnType}
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
          def field_def(:sqlite_type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "sqliteType",
               kind: {:scalar, ""},
               label: :optional,
               name: :sqlite_type,
               tag: 2,
               type: :string
             }}
          end

          def field_def("sqliteType") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "sqliteType",
               kind: {:scalar, ""},
               label: :optional,
               name: :sqlite_type,
               tag: 2,
               type: :string
             }}
          end

          def field_def("sqlite_type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "sqliteType",
               kind: {:scalar, ""},
               label: :optional,
               name: :sqlite_type,
               tag: 2,
               type: :string
             }}
          end
        ),
        (
          def field_def(:pg_type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pgType",
               kind: {:scalar, nil},
               label: :optional,
               name: :pg_type,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.PgColumnType}
             }}
          end

          def field_def("pgType") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pgType",
               kind: {:scalar, nil},
               label: :optional,
               name: :pg_type,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.PgColumnType}
             }}
          end

          def field_def("pg_type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pgType",
               kind: {:scalar, nil},
               label: :optional,
               name: :pg_type,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.PgColumnType}
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:sqlite_type) do
        {:ok, ""}
      end,
      def default(:pg_type) do
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
  defmodule Electric.Satellite.V12.SatOpMigrate.ForeignKey do
    @moduledoc false
    defstruct fk_cols: [], pk_table: "", pk_cols: [], __uf__: []

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
          |> encode_fk_cols(msg)
          |> encode_pk_table(msg)
          |> encode_pk_cols(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_fk_cols(acc, msg) do
          try do
            case msg.fk_cols do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\n", Protox.Encode.encode_string(value)]
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
            if msg.pk_table == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.pk_table)]
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
                    [acc, "\x1A", Protox.Encode.encode_string(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:pk_cols, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpMigrate.ForeignKey))
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
                {[fk_cols: msg.fk_cols ++ [delimited]], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[pk_table: delimited], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[pk_cols: msg.pk_cols ++ [delimited]], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpMigrate.ForeignKey,
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
          1 => {:fk_cols, :unpacked, :string},
          2 => {:pk_table, {:scalar, ""}, :string},
          3 => {:pk_cols, :unpacked, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          fk_cols: {1, :unpacked, :string},
          pk_cols: {3, :unpacked, :string},
          pk_table: {2, {:scalar, ""}, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "fkCols",
            kind: :unpacked,
            label: :repeated,
            name: :fk_cols,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "pkTable",
            kind: {:scalar, ""},
            label: :optional,
            name: :pk_table,
            tag: 2,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "pkCols",
            kind: :unpacked,
            label: :repeated,
            name: :pk_cols,
            tag: 3,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:fk_cols) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "fkCols",
               kind: :unpacked,
               label: :repeated,
               name: :fk_cols,
               tag: 1,
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
               tag: 1,
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
               tag: 1,
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
               kind: {:scalar, ""},
               label: :optional,
               name: :pk_table,
               tag: 2,
               type: :string
             }}
          end

          def field_def("pkTable") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pkTable",
               kind: {:scalar, ""},
               label: :optional,
               name: :pk_table,
               tag: 2,
               type: :string
             }}
          end

          def field_def("pk_table") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pkTable",
               kind: {:scalar, ""},
               label: :optional,
               name: :pk_table,
               tag: 2,
               type: :string
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
               tag: 3,
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
               tag: 3,
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
               tag: 3,
               type: :string
             }}
          end
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:fk_cols) do
        {:error, :no_default_value}
      end,
      def default(:pk_table) do
        {:ok, ""}
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
  defmodule Electric.Satellite.V12.SatOpMigrate.PgColumnType do
    @moduledoc false
    defstruct name: "", array: [], size: [], __uf__: []

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
          |> encode_array(msg)
          |> encode_size(msg)
          |> encode_unknown_fields(msg)
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
        defp encode_array(acc, msg) do
          try do
            case msg.array do
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
              reraise Protox.EncodingError.new(:array, "invalid field value"), __STACKTRACE__
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
              reraise Protox.EncodingError.new(:size, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpMigrate.PgColumnType))
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
                {[array: msg.array ++ Protox.Decode.parse_repeated_int32([], delimited)], rest}

              {2, _, bytes} ->
                {value, rest} = Protox.Decode.parse_int32(bytes)
                {[array: msg.array ++ [value]], rest}

              {3, 2, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[size: msg.size ++ Protox.Decode.parse_repeated_int32([], delimited)], rest}

              {3, _, bytes} ->
                {value, rest} = Protox.Decode.parse_int32(bytes)
                {[size: msg.size ++ [value]], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpMigrate.PgColumnType,
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
          2 => {:array, :packed, :int32},
          3 => {:size, :packed, :int32}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          array: {2, :packed, :int32},
          name: {1, {:scalar, ""}, :string},
          size: {3, :packed, :int32}
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
            json_name: "array",
            kind: :packed,
            label: :repeated,
            name: :array,
            tag: 2,
            type: :int32
          },
          %{
            __struct__: Protox.Field,
            json_name: "size",
            kind: :packed,
            label: :repeated,
            name: :size,
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
          def field_def(:array) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "array",
               kind: :packed,
               label: :repeated,
               name: :array,
               tag: 2,
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
               tag: 2,
               type: :int32
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
               tag: 3,
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

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:array) do
        {:error, :no_default_value}
      end,
      def default(:size) do
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
  defmodule Electric.Satellite.V12.SatOpMigrate.Stmt do
    @moduledoc false
    defstruct type: :CREATE_TABLE, sql: "", __uf__: []

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
          [] |> encode_type(msg) |> encode_sql(msg) |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_type(acc, msg) do
          try do
            if msg.type == :CREATE_TABLE do
              acc
            else
              [
                acc,
                "\b",
                msg.type
                |> Electric.Satellite.V12.SatOpMigrate.Type.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:type, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_sql(acc, msg) do
          try do
            if msg.sql == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.sql)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:sql, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpMigrate.Stmt))
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
                  Protox.Decode.parse_enum(bytes, Electric.Satellite.V12.SatOpMigrate.Type)

                {[type: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[sql: delimited], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpMigrate.Stmt,
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
            {:type, {:scalar, :CREATE_TABLE}, {:enum, Electric.Satellite.V12.SatOpMigrate.Type}},
          2 => {:sql, {:scalar, ""}, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          sql: {2, {:scalar, ""}, :string},
          type: {1, {:scalar, :CREATE_TABLE}, {:enum, Electric.Satellite.V12.SatOpMigrate.Type}}
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
            kind: {:scalar, :CREATE_TABLE},
            label: :optional,
            name: :type,
            tag: 1,
            type: {:enum, Electric.Satellite.V12.SatOpMigrate.Type}
          },
          %{
            __struct__: Protox.Field,
            json_name: "sql",
            kind: {:scalar, ""},
            label: :optional,
            name: :sql,
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
               kind: {:scalar, :CREATE_TABLE},
               label: :optional,
               name: :type,
               tag: 1,
               type: {:enum, Electric.Satellite.V12.SatOpMigrate.Type}
             }}
          end

          def field_def("type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, :CREATE_TABLE},
               label: :optional,
               name: :type,
               tag: 1,
               type: {:enum, Electric.Satellite.V12.SatOpMigrate.Type}
             }}
          end

          []
        ),
        (
          def field_def(:sql) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "sql",
               kind: {:scalar, ""},
               label: :optional,
               name: :sql,
               tag: 2,
               type: :string
             }}
          end

          def field_def("sql") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "sql",
               kind: {:scalar, ""},
               label: :optional,
               name: :sql,
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

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
        {:ok, :CREATE_TABLE}
      end,
      def default(:sql) do
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
  defmodule Electric.Satellite.V12.SatOpMigrate.Table do
    @moduledoc false
    defstruct name: "", columns: [], fks: [], pks: [], __uf__: []

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
          |> encode_fks(msg)
          |> encode_pks(msg)
          |> encode_unknown_fields(msg)
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
        defp encode_fks(acc, msg) do
          try do
            case msg.fks do
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
              reraise Protox.EncodingError.new(:fks, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_pks(acc, msg) do
          try do
            case msg.pks do
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
              reraise Protox.EncodingError.new(:pks, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpMigrate.Table))
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
                   columns:
                     msg.columns ++
                       [Electric.Satellite.V12.SatOpMigrate.Column.decode!(delimited)]
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   fks:
                     msg.fks ++
                       [Electric.Satellite.V12.SatOpMigrate.ForeignKey.decode!(delimited)]
                 ], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[pks: msg.pks ++ [delimited]], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpMigrate.Table,
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
          2 => {:columns, :unpacked, {:message, Electric.Satellite.V12.SatOpMigrate.Column}},
          3 => {:fks, :unpacked, {:message, Electric.Satellite.V12.SatOpMigrate.ForeignKey}},
          4 => {:pks, :unpacked, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          columns: {2, :unpacked, {:message, Electric.Satellite.V12.SatOpMigrate.Column}},
          fks: {3, :unpacked, {:message, Electric.Satellite.V12.SatOpMigrate.ForeignKey}},
          name: {1, {:scalar, ""}, :string},
          pks: {4, :unpacked, :string}
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
            json_name: "columns",
            kind: :unpacked,
            label: :repeated,
            name: :columns,
            tag: 2,
            type: {:message, Electric.Satellite.V12.SatOpMigrate.Column}
          },
          %{
            __struct__: Protox.Field,
            json_name: "fks",
            kind: :unpacked,
            label: :repeated,
            name: :fks,
            tag: 3,
            type: {:message, Electric.Satellite.V12.SatOpMigrate.ForeignKey}
          },
          %{
            __struct__: Protox.Field,
            json_name: "pks",
            kind: :unpacked,
            label: :repeated,
            name: :pks,
            tag: 4,
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
          def field_def(:columns) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "columns",
               kind: :unpacked,
               label: :repeated,
               name: :columns,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.Column}
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
               type: {:message, Electric.Satellite.V12.SatOpMigrate.Column}
             }}
          end

          []
        ),
        (
          def field_def(:fks) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "fks",
               kind: :unpacked,
               label: :repeated,
               name: :fks,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.ForeignKey}
             }}
          end

          def field_def("fks") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "fks",
               kind: :unpacked,
               label: :repeated,
               name: :fks,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpMigrate.ForeignKey}
             }}
          end

          []
        ),
        (
          def field_def(:pks) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pks",
               kind: :unpacked,
               label: :repeated,
               name: :pks,
               tag: 4,
               type: :string
             }}
          end

          def field_def("pks") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "pks",
               kind: :unpacked,
               label: :repeated,
               name: :pks,
               tag: 4,
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

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:columns) do
        {:error, :no_default_value}
      end,
      def default(:fks) do
        {:error, :no_default_value}
      end,
      def default(:pks) do
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
  defmodule Electric.Satellite.V12.SatOpRow do
    @moduledoc false
    defstruct nulls_bitmask: "", values: [], __uf__: []

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
          [] |> encode_nulls_bitmask(msg) |> encode_values(msg) |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_nulls_bitmask(acc, msg) do
          try do
            if msg.nulls_bitmask == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_bytes(msg.nulls_bitmask)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:nulls_bitmask, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_values(acc, msg) do
          try do
            case msg.values do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x12", Protox.Encode.encode_bytes(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:values, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpRow))
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
                {[nulls_bitmask: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[values: msg.values ++ [delimited]], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpRow,
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
        %{1 => {:nulls_bitmask, {:scalar, ""}, :bytes}, 2 => {:values, :unpacked, :bytes}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{nulls_bitmask: {1, {:scalar, ""}, :bytes}, values: {2, :unpacked, :bytes}}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "nullsBitmask",
            kind: {:scalar, ""},
            label: :optional,
            name: :nulls_bitmask,
            tag: 1,
            type: :bytes
          },
          %{
            __struct__: Protox.Field,
            json_name: "values",
            kind: :unpacked,
            label: :repeated,
            name: :values,
            tag: 2,
            type: :bytes
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:nulls_bitmask) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullsBitmask",
               kind: {:scalar, ""},
               label: :optional,
               name: :nulls_bitmask,
               tag: 1,
               type: :bytes
             }}
          end

          def field_def("nullsBitmask") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullsBitmask",
               kind: {:scalar, ""},
               label: :optional,
               name: :nulls_bitmask,
               tag: 1,
               type: :bytes
             }}
          end

          def field_def("nulls_bitmask") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "nullsBitmask",
               kind: {:scalar, ""},
               label: :optional,
               name: :nulls_bitmask,
               tag: 1,
               type: :bytes
             }}
          end
        ),
        (
          def field_def(:values) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "values",
               kind: :unpacked,
               label: :repeated,
               name: :values,
               tag: 2,
               type: :bytes
             }}
          end

          def field_def("values") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "values",
               kind: :unpacked,
               label: :repeated,
               name: :values,
               tag: 2,
               type: :bytes
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:nulls_bitmask) do
        {:ok, ""}
      end,
      def default(:values) do
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
  defmodule Electric.Satellite.V12.SatOpUpdate do
    @moduledoc false
    defstruct relation_id: 0, row_data: nil, old_row_data: nil, tags: [], __uf__: []

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
          |> encode_relation_id(msg)
          |> encode_row_data(msg)
          |> encode_old_row_data(msg)
          |> encode_tags(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_relation_id(acc, msg) do
          try do
            if msg.relation_id == 0 do
              acc
            else
              [acc, "\b", Protox.Encode.encode_uint32(msg.relation_id)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:relation_id, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_row_data(acc, msg) do
          try do
            if msg.row_data == nil do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_message(msg.row_data)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:row_data, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_old_row_data(acc, msg) do
          try do
            if msg.old_row_data == nil do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_message(msg.old_row_data)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:old_row_data, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_tags(acc, msg) do
          try do
            case msg.tags do
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
              reraise Protox.EncodingError.new(:tags, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatOpUpdate))
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
                {value, rest} = Protox.Decode.parse_uint32(bytes)
                {[relation_id: value], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   row_data:
                     Protox.MergeMessage.merge(
                       msg.row_data,
                       Electric.Satellite.V12.SatOpRow.decode!(delimited)
                     )
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   old_row_data:
                     Protox.MergeMessage.merge(
                       msg.old_row_data,
                       Electric.Satellite.V12.SatOpRow.decode!(delimited)
                     )
                 ], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[tags: msg.tags ++ [delimited]], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatOpUpdate,
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
          1 => {:relation_id, {:scalar, 0}, :uint32},
          2 => {:row_data, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpRow}},
          3 => {:old_row_data, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpRow}},
          4 => {:tags, :unpacked, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          old_row_data: {3, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpRow}},
          relation_id: {1, {:scalar, 0}, :uint32},
          row_data: {2, {:scalar, nil}, {:message, Electric.Satellite.V12.SatOpRow}},
          tags: {4, :unpacked, :string}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "relationId",
            kind: {:scalar, 0},
            label: :optional,
            name: :relation_id,
            tag: 1,
            type: :uint32
          },
          %{
            __struct__: Protox.Field,
            json_name: "rowData",
            kind: {:scalar, nil},
            label: :optional,
            name: :row_data,
            tag: 2,
            type: {:message, Electric.Satellite.V12.SatOpRow}
          },
          %{
            __struct__: Protox.Field,
            json_name: "oldRowData",
            kind: {:scalar, nil},
            label: :optional,
            name: :old_row_data,
            tag: 3,
            type: {:message, Electric.Satellite.V12.SatOpRow}
          },
          %{
            __struct__: Protox.Field,
            json_name: "tags",
            kind: :unpacked,
            label: :repeated,
            name: :tags,
            tag: 4,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:relation_id) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end

          def field_def("relationId") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end

          def field_def("relation_id") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 1,
               type: :uint32
             }}
          end
        ),
        (
          def field_def(:row_data) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end

          def field_def("rowData") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end

          def field_def("row_data") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :row_data,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end
        ),
        (
          def field_def(:old_row_data) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :old_row_data,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end

          def field_def("oldRowData") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :old_row_data,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end

          def field_def("old_row_data") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: {:scalar, nil},
               label: :optional,
               name: :old_row_data,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpRow}
             }}
          end
        ),
        (
          def field_def(:tags) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tags",
               kind: :unpacked,
               label: :repeated,
               name: :tags,
               tag: 4,
               type: :string
             }}
          end

          def field_def("tags") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tags",
               kind: :unpacked,
               label: :repeated,
               name: :tags,
               tag: 4,
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

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:relation_id) do
        {:ok, 0}
      end,
      def default(:row_data) do
        {:ok, nil}
      end,
      def default(:old_row_data) do
        {:ok, nil}
      end,
      def default(:tags) do
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
  defmodule Electric.Satellite.V12.SatPingReq do
    @moduledoc false
    defstruct __uf__: []

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
          [] |> encode_unknown_fields(msg)
        end
      )

      []
      []

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatPingReq))
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

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatPingReq,
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
        %{}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        []
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
  defmodule Electric.Satellite.V12.SatPingResp do
    @moduledoc false
    defstruct lsn: nil, __uf__: []

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
          [] |> encode_lsn(msg) |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_lsn(acc, msg) do
          try do
            case msg.lsn do
              nil -> [acc]
              child_field_value -> [acc, "\n", Protox.Encode.encode_bytes(child_field_value)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:lsn, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatPingResp))
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
                {[lsn: delimited], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatPingResp,
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
        %{1 => {:lsn, {:oneof, :_lsn}, :bytes}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{lsn: {1, {:oneof, :_lsn}, :bytes}}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "lsn",
            kind: {:oneof, :_lsn},
            label: :proto3_optional,
            name: :lsn,
            tag: 1,
            type: :bytes
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:lsn) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "lsn",
               kind: {:oneof, :_lsn},
               label: :proto3_optional,
               name: :lsn,
               tag: 1,
               type: :bytes
             }}
          end

          def field_def("lsn") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "lsn",
               kind: {:oneof, :_lsn},
               label: :proto3_optional,
               name: :lsn,
               tag: 1,
               type: :bytes
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:lsn) do
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
  defmodule Electric.Satellite.V12.SatRelation do
    @moduledoc false
    defstruct schema_name: "",
              table_type: :TABLE,
              table_name: "",
              relation_id: 0,
              columns: [],
              __uf__: []

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
          |> encode_schema_name(msg)
          |> encode_table_type(msg)
          |> encode_table_name(msg)
          |> encode_relation_id(msg)
          |> encode_columns(msg)
          |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_schema_name(acc, msg) do
          try do
            if msg.schema_name == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.schema_name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:schema_name, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_table_type(acc, msg) do
          try do
            if msg.table_type == :TABLE do
              acc
            else
              [
                acc,
                "\x10",
                msg.table_type
                |> Electric.Satellite.V12.SatRelation.RelationType.encode()
                |> Protox.Encode.encode_enum()
              ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:table_type, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_table_name(acc, msg) do
          try do
            if msg.table_name == "" do
              acc
            else
              [acc, "\x1A", Protox.Encode.encode_string(msg.table_name)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:table_name, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_relation_id(acc, msg) do
          try do
            if msg.relation_id == 0 do
              acc
            else
              [acc, " ", Protox.Encode.encode_uint32(msg.relation_id)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:relation_id, "invalid field value"),
                      __STACKTRACE__
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
                    [acc, "*", Protox.Encode.encode_message(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:columns, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatRelation))
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
                {[schema_name: delimited], rest}

              {2, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(bytes, Electric.Satellite.V12.SatRelation.RelationType)

                {[table_type: value], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[table_name: delimited], rest}

              {4, _, bytes} ->
                {value, rest} = Protox.Decode.parse_uint32(bytes)
                {[relation_id: value], rest}

              {5, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   columns:
                     msg.columns ++ [Electric.Satellite.V12.SatRelationColumn.decode!(delimited)]
                 ], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatRelation,
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
          1 => {:schema_name, {:scalar, ""}, :string},
          2 =>
            {:table_type, {:scalar, :TABLE},
             {:enum, Electric.Satellite.V12.SatRelation.RelationType}},
          3 => {:table_name, {:scalar, ""}, :string},
          4 => {:relation_id, {:scalar, 0}, :uint32},
          5 => {:columns, :unpacked, {:message, Electric.Satellite.V12.SatRelationColumn}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          columns: {5, :unpacked, {:message, Electric.Satellite.V12.SatRelationColumn}},
          relation_id: {4, {:scalar, 0}, :uint32},
          schema_name: {1, {:scalar, ""}, :string},
          table_name: {3, {:scalar, ""}, :string},
          table_type:
            {2, {:scalar, :TABLE}, {:enum, Electric.Satellite.V12.SatRelation.RelationType}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "schemaName",
            kind: {:scalar, ""},
            label: :optional,
            name: :schema_name,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "tableType",
            kind: {:scalar, :TABLE},
            label: :optional,
            name: :table_type,
            tag: 2,
            type: {:enum, Electric.Satellite.V12.SatRelation.RelationType}
          },
          %{
            __struct__: Protox.Field,
            json_name: "tableName",
            kind: {:scalar, ""},
            label: :optional,
            name: :table_name,
            tag: 3,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "relationId",
            kind: {:scalar, 0},
            label: :optional,
            name: :relation_id,
            tag: 4,
            type: :uint32
          },
          %{
            __struct__: Protox.Field,
            json_name: "columns",
            kind: :unpacked,
            label: :repeated,
            name: :columns,
            tag: 5,
            type: {:message, Electric.Satellite.V12.SatRelationColumn}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:schema_name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "schemaName",
               kind: {:scalar, ""},
               label: :optional,
               name: :schema_name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("schemaName") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "schemaName",
               kind: {:scalar, ""},
               label: :optional,
               name: :schema_name,
               tag: 1,
               type: :string
             }}
          end

          def field_def("schema_name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "schemaName",
               kind: {:scalar, ""},
               label: :optional,
               name: :schema_name,
               tag: 1,
               type: :string
             }}
          end
        ),
        (
          def field_def(:table_type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tableType",
               kind: {:scalar, :TABLE},
               label: :optional,
               name: :table_type,
               tag: 2,
               type: {:enum, Electric.Satellite.V12.SatRelation.RelationType}
             }}
          end

          def field_def("tableType") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tableType",
               kind: {:scalar, :TABLE},
               label: :optional,
               name: :table_type,
               tag: 2,
               type: {:enum, Electric.Satellite.V12.SatRelation.RelationType}
             }}
          end

          def field_def("table_type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tableType",
               kind: {:scalar, :TABLE},
               label: :optional,
               name: :table_type,
               tag: 2,
               type: {:enum, Electric.Satellite.V12.SatRelation.RelationType}
             }}
          end
        ),
        (
          def field_def(:table_name) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tableName",
               kind: {:scalar, ""},
               label: :optional,
               name: :table_name,
               tag: 3,
               type: :string
             }}
          end

          def field_def("tableName") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tableName",
               kind: {:scalar, ""},
               label: :optional,
               name: :table_name,
               tag: 3,
               type: :string
             }}
          end

          def field_def("table_name") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "tableName",
               kind: {:scalar, ""},
               label: :optional,
               name: :table_name,
               tag: 3,
               type: :string
             }}
          end
        ),
        (
          def field_def(:relation_id) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 4,
               type: :uint32
             }}
          end

          def field_def("relationId") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 4,
               type: :uint32
             }}
          end

          def field_def("relation_id") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "relationId",
               kind: {:scalar, 0},
               label: :optional,
               name: :relation_id,
               tag: 4,
               type: :uint32
             }}
          end
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
               tag: 5,
               type: {:message, Electric.Satellite.V12.SatRelationColumn}
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
               tag: 5,
               type: {:message, Electric.Satellite.V12.SatRelationColumn}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:schema_name) do
        {:ok, ""}
      end,
      def default(:table_type) do
        {:ok, :TABLE}
      end,
      def default(:table_name) do
        {:ok, ""}
      end,
      def default(:relation_id) do
        {:ok, 0}
      end,
      def default(:columns) do
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
  defmodule Electric.Satellite.V12.SatRelationColumn do
    @moduledoc false
    defstruct name: "", type: "", __uf__: []

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
          [] |> encode_name(msg) |> encode_type(msg) |> encode_unknown_fields(msg)
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
            if msg.type == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.type)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:type, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatRelationColumn))
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
                {[type: delimited], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatRelationColumn,
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
        %{1 => {:name, {:scalar, ""}, :string}, 2 => {:type, {:scalar, ""}, :string}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{name: {1, {:scalar, ""}, :string}, type: {2, {:scalar, ""}, :string}}
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
            kind: {:scalar, ""},
            label: :optional,
            name: :type,
            tag: 2,
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
          def field_def(:type) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, ""},
               label: :optional,
               name: :type,
               tag: 2,
               type: :string
             }}
          end

          def field_def("type") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "type",
               kind: {:scalar, ""},
               label: :optional,
               name: :type,
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

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
  defmodule Electric.Satellite.V12.SatTransOp do
    @moduledoc false
    defstruct op: nil, __uf__: []

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
          [] |> encode_op(msg) |> encode_unknown_fields(msg)
        end
      )

      [
        defp encode_op(acc, msg) do
          case msg.op do
            nil -> acc
            {:begin, _field_value} -> encode_begin(acc, msg)
            {:commit, _field_value} -> encode_commit(acc, msg)
            {:update, _field_value} -> encode_update(acc, msg)
            {:insert, _field_value} -> encode_insert(acc, msg)
            {:delete, _field_value} -> encode_delete(acc, msg)
            {:migrate, _field_value} -> encode_migrate(acc, msg)
          end
        end
      ]

      [
        defp encode_begin(acc, msg) do
          try do
            {_, child_field_value} = msg.op
            [acc, "\n", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:begin, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_commit(acc, msg) do
          try do
            {_, child_field_value} = msg.op
            [acc, "\x12", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:commit, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_update(acc, msg) do
          try do
            {_, child_field_value} = msg.op
            [acc, "\x1A", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:update, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_insert(acc, msg) do
          try do
            {_, child_field_value} = msg.op
            [acc, "\"", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:insert, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_delete(acc, msg) do
          try do
            {_, child_field_value} = msg.op
            [acc, "*", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:delete, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_migrate(acc, msg) do
          try do
            {_, child_field_value} = msg.op
            [acc, "2", Protox.Encode.encode_message(child_field_value)]
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:migrate, "invalid field value"), __STACKTRACE__
          end
        end
      ]

      defp encode_unknown_fields(acc, msg) do
        Enum.reduce(msg.__struct__.unknown_fields(msg), acc, fn {tag, wire_type, bytes}, acc ->
          case wire_type do
            0 ->
              [acc, Protox.Encode.make_key_bytes(tag, :int32), bytes]

            1 ->
              [acc, Protox.Encode.make_key_bytes(tag, :double), bytes]

            2 ->
              len_bytes = bytes |> byte_size() |> Protox.Varint.encode()
              [acc, Protox.Encode.make_key_bytes(tag, :packed), len_bytes, bytes]

            5 ->
              [acc, Protox.Encode.make_key_bytes(tag, :float), bytes]
          end
        end)
      end
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
            parse_key_value(bytes, struct(Electric.Satellite.V12.SatTransOp))
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
                   case msg.op do
                     {:begin, previous_value} ->
                       {:op,
                        {:begin,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Satellite.V12.SatOpBegin.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:begin, Electric.Satellite.V12.SatOpBegin.decode!(delimited)}}
                   end
                 ], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.op do
                     {:commit, previous_value} ->
                       {:op,
                        {:commit,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Satellite.V12.SatOpCommit.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:commit, Electric.Satellite.V12.SatOpCommit.decode!(delimited)}}
                   end
                 ], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.op do
                     {:update, previous_value} ->
                       {:op,
                        {:update,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Satellite.V12.SatOpUpdate.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:update, Electric.Satellite.V12.SatOpUpdate.decode!(delimited)}}
                   end
                 ], rest}

              {4, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.op do
                     {:insert, previous_value} ->
                       {:op,
                        {:insert,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Satellite.V12.SatOpInsert.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:insert, Electric.Satellite.V12.SatOpInsert.decode!(delimited)}}
                   end
                 ], rest}

              {5, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.op do
                     {:delete, previous_value} ->
                       {:op,
                        {:delete,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Satellite.V12.SatOpDelete.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:delete, Electric.Satellite.V12.SatOpDelete.decode!(delimited)}}
                   end
                 ], rest}

              {6, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)

                {[
                   case msg.op do
                     {:migrate, previous_value} ->
                       {:op,
                        {:migrate,
                         Protox.MergeMessage.merge(
                           previous_value,
                           Electric.Satellite.V12.SatOpMigrate.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:migrate, Electric.Satellite.V12.SatOpMigrate.decode!(delimited)}}
                   end
                 ], rest}

              {tag, wire_type, rest} ->
                {value, rest} = Protox.Decode.parse_unknown(tag, wire_type, rest)

                {[
                   {msg.__struct__.unknown_fields_name,
                    [value | msg.__struct__.unknown_fields(msg)]}
                 ], rest}
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
          Electric.Satellite.V12.SatTransOp,
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
          1 => {:begin, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpBegin}},
          2 => {:commit, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpCommit}},
          3 => {:update, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpUpdate}},
          4 => {:insert, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpInsert}},
          5 => {:delete, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpDelete}},
          6 => {:migrate, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpMigrate}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          begin: {1, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpBegin}},
          commit: {2, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpCommit}},
          delete: {5, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpDelete}},
          insert: {4, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpInsert}},
          migrate: {6, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpMigrate}},
          update: {3, {:oneof, :op}, {:message, Electric.Satellite.V12.SatOpUpdate}}
        }
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "begin",
            kind: {:oneof, :op},
            label: :optional,
            name: :begin,
            tag: 1,
            type: {:message, Electric.Satellite.V12.SatOpBegin}
          },
          %{
            __struct__: Protox.Field,
            json_name: "commit",
            kind: {:oneof, :op},
            label: :optional,
            name: :commit,
            tag: 2,
            type: {:message, Electric.Satellite.V12.SatOpCommit}
          },
          %{
            __struct__: Protox.Field,
            json_name: "update",
            kind: {:oneof, :op},
            label: :optional,
            name: :update,
            tag: 3,
            type: {:message, Electric.Satellite.V12.SatOpUpdate}
          },
          %{
            __struct__: Protox.Field,
            json_name: "insert",
            kind: {:oneof, :op},
            label: :optional,
            name: :insert,
            tag: 4,
            type: {:message, Electric.Satellite.V12.SatOpInsert}
          },
          %{
            __struct__: Protox.Field,
            json_name: "delete",
            kind: {:oneof, :op},
            label: :optional,
            name: :delete,
            tag: 5,
            type: {:message, Electric.Satellite.V12.SatOpDelete}
          },
          %{
            __struct__: Protox.Field,
            json_name: "migrate",
            kind: {:oneof, :op},
            label: :optional,
            name: :migrate,
            tag: 6,
            type: {:message, Electric.Satellite.V12.SatOpMigrate}
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:begin) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "begin",
               kind: {:oneof, :op},
               label: :optional,
               name: :begin,
               tag: 1,
               type: {:message, Electric.Satellite.V12.SatOpBegin}
             }}
          end

          def field_def("begin") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "begin",
               kind: {:oneof, :op},
               label: :optional,
               name: :begin,
               tag: 1,
               type: {:message, Electric.Satellite.V12.SatOpBegin}
             }}
          end

          []
        ),
        (
          def field_def(:commit) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "commit",
               kind: {:oneof, :op},
               label: :optional,
               name: :commit,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpCommit}
             }}
          end

          def field_def("commit") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "commit",
               kind: {:oneof, :op},
               label: :optional,
               name: :commit,
               tag: 2,
               type: {:message, Electric.Satellite.V12.SatOpCommit}
             }}
          end

          []
        ),
        (
          def field_def(:update) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "update",
               kind: {:oneof, :op},
               label: :optional,
               name: :update,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpUpdate}
             }}
          end

          def field_def("update") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "update",
               kind: {:oneof, :op},
               label: :optional,
               name: :update,
               tag: 3,
               type: {:message, Electric.Satellite.V12.SatOpUpdate}
             }}
          end

          []
        ),
        (
          def field_def(:insert) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "insert",
               kind: {:oneof, :op},
               label: :optional,
               name: :insert,
               tag: 4,
               type: {:message, Electric.Satellite.V12.SatOpInsert}
             }}
          end

          def field_def("insert") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "insert",
               kind: {:oneof, :op},
               label: :optional,
               name: :insert,
               tag: 4,
               type: {:message, Electric.Satellite.V12.SatOpInsert}
             }}
          end

          []
        ),
        (
          def field_def(:delete) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "delete",
               kind: {:oneof, :op},
               label: :optional,
               name: :delete,
               tag: 5,
               type: {:message, Electric.Satellite.V12.SatOpDelete}
             }}
          end

          def field_def("delete") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "delete",
               kind: {:oneof, :op},
               label: :optional,
               name: :delete,
               tag: 5,
               type: {:message, Electric.Satellite.V12.SatOpDelete}
             }}
          end

          []
        ),
        (
          def field_def(:migrate) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "migrate",
               kind: {:oneof, :op},
               label: :optional,
               name: :migrate,
               tag: 6,
               type: {:message, Electric.Satellite.V12.SatOpMigrate}
             }}
          end

          def field_def("migrate") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "migrate",
               kind: {:oneof, :op},
               label: :optional,
               name: :migrate,
               tag: 6,
               type: {:message, Electric.Satellite.V12.SatOpMigrate}
             }}
          end

          []
        ),
        def field_def(_) do
          {:error, :no_such_field}
        end
      ]
    )

    (
      @spec unknown_fields(struct) :: [{non_neg_integer, Protox.Types.tag(), binary}]
      def unknown_fields(msg) do
        msg.__uf__
      end

      @spec unknown_fields_name() :: :__uf__
      def unknown_fields_name() do
        :__uf__
      end

      @spec clear_unknown_fields(struct) :: struct
      def clear_unknown_fields(msg) do
        struct!(msg, [{unknown_fields_name(), []}])
      end
    )

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
      def default(:begin) do
        {:error, :no_default_value}
      end,
      def default(:commit) do
        {:error, :no_default_value}
      end,
      def default(:update) do
        {:error, :no_default_value}
      end,
      def default(:insert) do
        {:error, :no_default_value}
      end,
      def default(:delete) do
        {:error, :no_default_value}
      end,
      def default(:migrate) do
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
