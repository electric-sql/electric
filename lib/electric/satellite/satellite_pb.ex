# credo:disable-for-this-file
[
  defmodule Electric.Satellite.SatErrorResp.ErrorCode do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :INTERNAL
        def default() do
          :INTERNAL
        end
      )

      @spec encode(atom()) :: integer() | atom()
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
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :INTERNAL}, {1, :AUTH_REQUIRED}, {2, :AUTH_FAILED}, {3, :REPLICATION_FAILED}]
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
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Satellite.SatInStartReplicationReq.Option do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :NONE
        def default() do
          :NONE
        end
      )

      @spec encode(atom()) :: integer() | atom()
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
        end
      ]

      def decode(x) do
        x
      end

      @spec constants() :: [{integer(), atom()}]
      def constants() do
        [{0, :NONE}, {1, :LAST_ACKNOWLEDGED}, {2, :SYNC_MODE}]
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
          end
        ]

        def has_constant?(_) do
          false
        end
      )
    )
  end,
  defmodule Electric.Satellite.SatRelation.RelationType do
    @moduledoc false
    (
      defstruct []

      (
        @spec default() :: :TABLE
        def default() do
          :TABLE
        end
      )

      @spec encode(atom()) :: integer() | atom()
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
  defmodule Electric.Satellite.SatAuthReq do
    @moduledoc false
    defstruct id: "", token: "", __uf__: []

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
          [] |> encode_id(msg) |> encode_token(msg) |> encode_unknown_fields(msg)
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
            parse_key_value(bytes, struct(Electric.Satellite.SatAuthReq))
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
          Electric.Satellite.SatAuthReq,
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
        %{1 => {:id, {:scalar, ""}, :string}, 2 => {:token, {:scalar, ""}, :string}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{id: {1, {:scalar, ""}, :string}, token: {2, {:scalar, ""}, :string}}
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
  defmodule Electric.Satellite.SatAuthResp do
    @moduledoc false
    defstruct id: "", __uf__: []

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
          [] |> encode_id(msg) |> encode_unknown_fields(msg)
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
            parse_key_value(bytes, struct(Electric.Satellite.SatAuthResp))
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
          Electric.Satellite.SatAuthResp,
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
        %{1 => {:id, {:scalar, ""}, :string}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{id: {1, {:scalar, ""}, :string}}
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
  defmodule Electric.Satellite.SatErrorResp do
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
                |> Electric.Satellite.SatErrorResp.ErrorCode.encode()
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
            parse_key_value(bytes, struct(Electric.Satellite.SatErrorResp))
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
                  Protox.Decode.parse_enum(bytes, Electric.Satellite.SatErrorResp.ErrorCode)

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
          Electric.Satellite.SatErrorResp,
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
             {:enum, Electric.Satellite.SatErrorResp.ErrorCode}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          error_type:
            {1, {:scalar, :INTERNAL}, {:enum, Electric.Satellite.SatErrorResp.ErrorCode}}
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
            type: {:enum, Electric.Satellite.SatErrorResp.ErrorCode}
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
               type: {:enum, Electric.Satellite.SatErrorResp.ErrorCode}
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
               type: {:enum, Electric.Satellite.SatErrorResp.ErrorCode}
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
               type: {:enum, Electric.Satellite.SatErrorResp.ErrorCode}
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
  defmodule Electric.Satellite.SatGetServerInfoReq do
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
            parse_key_value(bytes, struct(Electric.Satellite.SatGetServerInfoReq))
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
          Electric.Satellite.SatGetServerInfoReq,
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
  defmodule Electric.Satellite.SatGetServerInfoResp do
    @moduledoc false
    defstruct server_version: "", node: "", __uf__: []

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
          [] |> encode_server_version(msg) |> encode_node(msg) |> encode_unknown_fields(msg)
        end
      )

      []

      [
        defp encode_server_version(acc, msg) do
          try do
            if msg.server_version == "" do
              acc
            else
              [acc, "\n", Protox.Encode.encode_string(msg.server_version)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:server_version, "invalid field value"),
                      __STACKTRACE__
          end
        end,
        defp encode_node(acc, msg) do
          try do
            if msg.node == "" do
              acc
            else
              [acc, "\x12", Protox.Encode.encode_string(msg.node)]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:node, "invalid field value"), __STACKTRACE__
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
            parse_key_value(bytes, struct(Electric.Satellite.SatGetServerInfoResp))
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
                {[server_version: delimited], rest}

              {2, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[node: delimited], rest}

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
          Electric.Satellite.SatGetServerInfoResp,
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
        %{1 => {:server_version, {:scalar, ""}, :string}, 2 => {:node, {:scalar, ""}, :string}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{node: {2, {:scalar, ""}, :string}, server_version: {1, {:scalar, ""}, :string}}
      end
    )

    (
      @spec fields_defs() :: list(Protox.Field.t())
      def fields_defs() do
        [
          %{
            __struct__: Protox.Field,
            json_name: "serverVersion",
            kind: {:scalar, ""},
            label: :optional,
            name: :server_version,
            tag: 1,
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "node",
            kind: {:scalar, ""},
            label: :optional,
            name: :node,
            tag: 2,
            type: :string
          }
        ]
      end

      [
        @spec(field_def(atom) :: {:ok, Protox.Field.t()} | {:error, :no_such_field}),
        (
          def field_def(:server_version) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "serverVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :server_version,
               tag: 1,
               type: :string
             }}
          end

          def field_def("serverVersion") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "serverVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :server_version,
               tag: 1,
               type: :string
             }}
          end

          def field_def("server_version") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "serverVersion",
               kind: {:scalar, ""},
               label: :optional,
               name: :server_version,
               tag: 1,
               type: :string
             }}
          end
        ),
        (
          def field_def(:node) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "node",
               kind: {:scalar, ""},
               label: :optional,
               name: :node,
               tag: 2,
               type: :string
             }}
          end

          def field_def("node") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "node",
               kind: {:scalar, ""},
               label: :optional,
               name: :node,
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
      def default(:server_version) do
        {:ok, ""}
      end,
      def default(:node) do
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
  defmodule Electric.Satellite.SatInStartReplicationReq do
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
              [acc, "\n", Protox.Encode.encode_string(msg.lsn)]
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
                            |> Electric.Satellite.SatInStartReplicationReq.Option.encode()
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
            parse_key_value(bytes, struct(Electric.Satellite.SatInStartReplicationReq))
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
                         Electric.Satellite.SatInStartReplicationReq.Option
                       )
                 ], rest}

              {2, _, bytes} ->
                {value, rest} =
                  Protox.Decode.parse_enum(
                    bytes,
                    Electric.Satellite.SatInStartReplicationReq.Option
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
          Electric.Satellite.SatInStartReplicationReq,
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
          1 => {:lsn, {:scalar, ""}, :string},
          2 => {:options, :packed, {:enum, Electric.Satellite.SatInStartReplicationReq.Option}},
          3 => {:sync_batch_size, {:scalar, 0}, :int32}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          lsn: {1, {:scalar, ""}, :string},
          options: {2, :packed, {:enum, Electric.Satellite.SatInStartReplicationReq.Option}},
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
            type: :string
          },
          %{
            __struct__: Protox.Field,
            json_name: "options",
            kind: :packed,
            label: :repeated,
            name: :options,
            tag: 2,
            type: {:enum, Electric.Satellite.SatInStartReplicationReq.Option}
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
               type: :string
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
               type: :string
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
               type: {:enum, Electric.Satellite.SatInStartReplicationReq.Option}
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
               type: {:enum, Electric.Satellite.SatInStartReplicationReq.Option}
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
  defmodule Electric.Satellite.SatInStartReplicationResp do
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
            parse_key_value(bytes, struct(Electric.Satellite.SatInStartReplicationResp))
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
          Electric.Satellite.SatInStartReplicationResp,
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
  defmodule Electric.Satellite.SatInStopReplicationReq do
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
            parse_key_value(bytes, struct(Electric.Satellite.SatInStopReplicationReq))
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
          Electric.Satellite.SatInStopReplicationReq,
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
  defmodule Electric.Satellite.SatInStopReplicationResp do
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
            parse_key_value(bytes, struct(Electric.Satellite.SatInStopReplicationResp))
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
          Electric.Satellite.SatInStopReplicationResp,
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
  defmodule Electric.Satellite.SatOpBegin do
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
              [acc, "\x1A", Protox.Encode.encode_string(msg.lsn)]
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
            parse_key_value(bytes, struct(Electric.Satellite.SatOpBegin))
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
          Electric.Satellite.SatOpBegin,
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
          3 => {:lsn, {:scalar, ""}, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          commit_timestamp: {1, {:scalar, 0}, :uint64},
          lsn: {3, {:scalar, ""}, :string},
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
            type: :string
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
               type: :string
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
  defmodule Electric.Satellite.SatOpCommit do
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
              [acc, "\x1A", Protox.Encode.encode_string(msg.lsn)]
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
            parse_key_value(bytes, struct(Electric.Satellite.SatOpCommit))
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
          Electric.Satellite.SatOpCommit,
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
          3 => {:lsn, {:scalar, ""}, :string}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          commit_timestamp: {1, {:scalar, 0}, :uint64},
          lsn: {3, {:scalar, ""}, :string},
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
            type: :string
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
               type: :string
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
  defmodule Electric.Satellite.SatOpDelete do
    @moduledoc false
    defstruct relation_id: 0, old_row_data: [], __uf__: []

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
          [] |> encode_relation_id(msg) |> encode_old_row_data(msg) |> encode_unknown_fields(msg)
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
            case msg.old_row_data do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x1A", Protox.Encode.encode_bytes(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:old_row_data, "invalid field value"),
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
            parse_key_value(bytes, struct(Electric.Satellite.SatOpDelete))
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

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[old_row_data: msg.old_row_data ++ [delimited]], rest}

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
          Electric.Satellite.SatOpDelete,
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
        %{1 => {:relation_id, {:scalar, 0}, :uint32}, 3 => {:old_row_data, :unpacked, :bytes}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{old_row_data: {3, :unpacked, :bytes}, relation_id: {1, {:scalar, 0}, :uint32}}
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
            kind: :unpacked,
            label: :repeated,
            name: :old_row_data,
            tag: 3,
            type: :bytes
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
               kind: :unpacked,
               label: :repeated,
               name: :old_row_data,
               tag: 3,
               type: :bytes
             }}
          end

          def field_def("oldRowData") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: :unpacked,
               label: :repeated,
               name: :old_row_data,
               tag: 3,
               type: :bytes
             }}
          end

          def field_def("old_row_data") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: :unpacked,
               label: :repeated,
               name: :old_row_data,
               tag: 3,
               type: :bytes
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
      def default(:relation_id) do
        {:ok, 0}
      end,
      def default(:old_row_data) do
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
  defmodule Electric.Satellite.SatOpInsert do
    @moduledoc false
    defstruct relation_id: 0, row_data: [], __uf__: []

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
          [] |> encode_relation_id(msg) |> encode_row_data(msg) |> encode_unknown_fields(msg)
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
            case msg.row_data do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x1A", Protox.Encode.encode_bytes(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:row_data, "invalid field value"), __STACKTRACE__
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
            parse_key_value(bytes, struct(Electric.Satellite.SatOpInsert))
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

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[row_data: msg.row_data ++ [delimited]], rest}

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
          Electric.Satellite.SatOpInsert,
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
        %{1 => {:relation_id, {:scalar, 0}, :uint32}, 3 => {:row_data, :unpacked, :bytes}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{relation_id: {1, {:scalar, 0}, :uint32}, row_data: {3, :unpacked, :bytes}}
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
            kind: :unpacked,
            label: :repeated,
            name: :row_data,
            tag: 3,
            type: :bytes
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
               kind: :unpacked,
               label: :repeated,
               name: :row_data,
               tag: 3,
               type: :bytes
             }}
          end

          def field_def("rowData") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: :unpacked,
               label: :repeated,
               name: :row_data,
               tag: 3,
               type: :bytes
             }}
          end

          def field_def("row_data") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: :unpacked,
               label: :repeated,
               name: :row_data,
               tag: 3,
               type: :bytes
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
      def default(:relation_id) do
        {:ok, 0}
      end,
      def default(:row_data) do
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
  defmodule Electric.Satellite.SatOpLog do
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
            parse_key_value(bytes, struct(Electric.Satellite.SatOpLog))
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
                {[ops: msg.ops ++ [Electric.Satellite.SatTransOp.decode!(delimited)]], rest}

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
          Electric.Satellite.SatOpLog,
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
        %{1 => {:ops, :unpacked, {:message, Electric.Satellite.SatTransOp}}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{ops: {1, :unpacked, {:message, Electric.Satellite.SatTransOp}}}
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
            type: {:message, Electric.Satellite.SatTransOp}
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
               type: {:message, Electric.Satellite.SatTransOp}
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
               type: {:message, Electric.Satellite.SatTransOp}
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
  defmodule Electric.Satellite.SatOpUpdate do
    @moduledoc false
    defstruct relation_id: 0, row_data: [], old_row_data: [], __uf__: []

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
            case msg.row_data do
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
              reraise Protox.EncodingError.new(:row_data, "invalid field value"), __STACKTRACE__
          end
        end,
        defp encode_old_row_data(acc, msg) do
          try do
            case msg.old_row_data do
              [] ->
                acc

              values ->
                [
                  acc,
                  Enum.reduce(values, [], fn value, acc ->
                    [acc, "\x1A", Protox.Encode.encode_bytes(value)]
                  end)
                ]
            end
          rescue
            ArgumentError ->
              reraise Protox.EncodingError.new(:old_row_data, "invalid field value"),
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
            parse_key_value(bytes, struct(Electric.Satellite.SatOpUpdate))
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
                {[row_data: msg.row_data ++ [delimited]], rest}

              {3, _, bytes} ->
                {len, bytes} = Protox.Varint.decode(bytes)
                {delimited, rest} = Protox.Decode.parse_delimited(bytes, len)
                {[old_row_data: msg.old_row_data ++ [delimited]], rest}

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
          Electric.Satellite.SatOpUpdate,
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
          2 => {:row_data, :unpacked, :bytes},
          3 => {:old_row_data, :unpacked, :bytes}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          old_row_data: {3, :unpacked, :bytes},
          relation_id: {1, {:scalar, 0}, :uint32},
          row_data: {2, :unpacked, :bytes}
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
            kind: :unpacked,
            label: :repeated,
            name: :row_data,
            tag: 2,
            type: :bytes
          },
          %{
            __struct__: Protox.Field,
            json_name: "oldRowData",
            kind: :unpacked,
            label: :repeated,
            name: :old_row_data,
            tag: 3,
            type: :bytes
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
               kind: :unpacked,
               label: :repeated,
               name: :row_data,
               tag: 2,
               type: :bytes
             }}
          end

          def field_def("rowData") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: :unpacked,
               label: :repeated,
               name: :row_data,
               tag: 2,
               type: :bytes
             }}
          end

          def field_def("row_data") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "rowData",
               kind: :unpacked,
               label: :repeated,
               name: :row_data,
               tag: 2,
               type: :bytes
             }}
          end
        ),
        (
          def field_def(:old_row_data) do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: :unpacked,
               label: :repeated,
               name: :old_row_data,
               tag: 3,
               type: :bytes
             }}
          end

          def field_def("oldRowData") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: :unpacked,
               label: :repeated,
               name: :old_row_data,
               tag: 3,
               type: :bytes
             }}
          end

          def field_def("old_row_data") do
            {:ok,
             %{
               __struct__: Protox.Field,
               json_name: "oldRowData",
               kind: :unpacked,
               label: :repeated,
               name: :old_row_data,
               tag: 3,
               type: :bytes
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
      def default(:relation_id) do
        {:ok, 0}
      end,
      def default(:row_data) do
        {:error, :no_default_value}
      end,
      def default(:old_row_data) do
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
  defmodule Electric.Satellite.SatPingReq do
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
            parse_key_value(bytes, struct(Electric.Satellite.SatPingReq))
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
          Electric.Satellite.SatPingReq,
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
  defmodule Electric.Satellite.SatPingResp do
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

      [
        defp encode__lsn(acc, msg) do
          case msg.lsn do
            nil -> acc
            {:lsn, _field_value} -> encode_lsn(acc, msg)
          end
        end
      ]

      [
        defp encode_lsn(acc, msg) do
          try do
            case msg.lsn do
              {_, child_field_value} ->
                [acc, "\n", Protox.Encode.encode_string(child_field_value)]

              child_field_value when not is_nil(child_field_value) ->
                [acc, "\n", Protox.Encode.encode_string(child_field_value)]

              _ ->
                [acc]
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
            parse_key_value(bytes, struct(Electric.Satellite.SatPingResp))
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
          Electric.Satellite.SatPingResp,
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
        %{1 => {:lsn, {:oneof, :_lsn}, :string}}
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{lsn: {1, {:oneof, :_lsn}, :string}}
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
            type: :string
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
               type: :string
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
  defmodule Electric.Satellite.SatRelation do
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
                |> Electric.Satellite.SatRelation.RelationType.encode()
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
            parse_key_value(bytes, struct(Electric.Satellite.SatRelation))
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
                  Protox.Decode.parse_enum(bytes, Electric.Satellite.SatRelation.RelationType)

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
                     msg.columns ++ [Electric.Satellite.SatRelationColumn.decode!(delimited)]
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
          Electric.Satellite.SatRelation,
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
            {:table_type, {:scalar, :TABLE}, {:enum, Electric.Satellite.SatRelation.RelationType}},
          3 => {:table_name, {:scalar, ""}, :string},
          4 => {:relation_id, {:scalar, 0}, :uint32},
          5 => {:columns, :unpacked, {:message, Electric.Satellite.SatRelationColumn}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          columns: {5, :unpacked, {:message, Electric.Satellite.SatRelationColumn}},
          relation_id: {4, {:scalar, 0}, :uint32},
          schema_name: {1, {:scalar, ""}, :string},
          table_name: {3, {:scalar, ""}, :string},
          table_type: {2, {:scalar, :TABLE}, {:enum, Electric.Satellite.SatRelation.RelationType}}
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
            type: {:enum, Electric.Satellite.SatRelation.RelationType}
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
            type: {:message, Electric.Satellite.SatRelationColumn}
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
               type: {:enum, Electric.Satellite.SatRelation.RelationType}
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
               type: {:enum, Electric.Satellite.SatRelation.RelationType}
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
               type: {:enum, Electric.Satellite.SatRelation.RelationType}
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
               type: {:message, Electric.Satellite.SatRelationColumn}
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
               type: {:message, Electric.Satellite.SatRelationColumn}
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
  defmodule Electric.Satellite.SatRelationColumn do
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
            parse_key_value(bytes, struct(Electric.Satellite.SatRelationColumn))
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
          Electric.Satellite.SatRelationColumn,
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
  defmodule Electric.Satellite.SatTransOp do
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
            parse_key_value(bytes, struct(Electric.Satellite.SatTransOp))
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
                           Electric.Satellite.SatOpBegin.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:begin, Electric.Satellite.SatOpBegin.decode!(delimited)}}
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
                           Electric.Satellite.SatOpCommit.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:commit, Electric.Satellite.SatOpCommit.decode!(delimited)}}
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
                           Electric.Satellite.SatOpUpdate.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:update, Electric.Satellite.SatOpUpdate.decode!(delimited)}}
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
                           Electric.Satellite.SatOpInsert.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:insert, Electric.Satellite.SatOpInsert.decode!(delimited)}}
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
                           Electric.Satellite.SatOpDelete.decode!(delimited)
                         )}}

                     _ ->
                       {:op, {:delete, Electric.Satellite.SatOpDelete.decode!(delimited)}}
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
          Electric.Satellite.SatTransOp,
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
          1 => {:begin, {:oneof, :op}, {:message, Electric.Satellite.SatOpBegin}},
          2 => {:commit, {:oneof, :op}, {:message, Electric.Satellite.SatOpCommit}},
          3 => {:update, {:oneof, :op}, {:message, Electric.Satellite.SatOpUpdate}},
          4 => {:insert, {:oneof, :op}, {:message, Electric.Satellite.SatOpInsert}},
          5 => {:delete, {:oneof, :op}, {:message, Electric.Satellite.SatOpDelete}}
        }
      end

      @deprecated "Use fields_defs()/0 instead"
      @spec defs_by_name() :: %{
              required(atom) => {non_neg_integer, Protox.Types.kind(), Protox.Types.type()}
            }
      def defs_by_name() do
        %{
          begin: {1, {:oneof, :op}, {:message, Electric.Satellite.SatOpBegin}},
          commit: {2, {:oneof, :op}, {:message, Electric.Satellite.SatOpCommit}},
          delete: {5, {:oneof, :op}, {:message, Electric.Satellite.SatOpDelete}},
          insert: {4, {:oneof, :op}, {:message, Electric.Satellite.SatOpInsert}},
          update: {3, {:oneof, :op}, {:message, Electric.Satellite.SatOpUpdate}}
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
            type: {:message, Electric.Satellite.SatOpBegin}
          },
          %{
            __struct__: Protox.Field,
            json_name: "commit",
            kind: {:oneof, :op},
            label: :optional,
            name: :commit,
            tag: 2,
            type: {:message, Electric.Satellite.SatOpCommit}
          },
          %{
            __struct__: Protox.Field,
            json_name: "update",
            kind: {:oneof, :op},
            label: :optional,
            name: :update,
            tag: 3,
            type: {:message, Electric.Satellite.SatOpUpdate}
          },
          %{
            __struct__: Protox.Field,
            json_name: "insert",
            kind: {:oneof, :op},
            label: :optional,
            name: :insert,
            tag: 4,
            type: {:message, Electric.Satellite.SatOpInsert}
          },
          %{
            __struct__: Protox.Field,
            json_name: "delete",
            kind: {:oneof, :op},
            label: :optional,
            name: :delete,
            tag: 5,
            type: {:message, Electric.Satellite.SatOpDelete}
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
               type: {:message, Electric.Satellite.SatOpBegin}
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
               type: {:message, Electric.Satellite.SatOpBegin}
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
               type: {:message, Electric.Satellite.SatOpCommit}
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
               type: {:message, Electric.Satellite.SatOpCommit}
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
               type: {:message, Electric.Satellite.SatOpUpdate}
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
               type: {:message, Electric.Satellite.SatOpUpdate}
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
               type: {:message, Electric.Satellite.SatOpInsert}
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
               type: {:message, Electric.Satellite.SatOpInsert}
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
               type: {:message, Electric.Satellite.SatOpDelete}
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
               type: {:message, Electric.Satellite.SatOpDelete}
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
