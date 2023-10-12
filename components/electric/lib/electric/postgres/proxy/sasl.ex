defmodule Electric.Postgres.Proxy.SASL do
  @moduledoc """
  Does the SASL authentication dance.

  See: https://www.postgresql.org/docs/current/sasl-authentication.html

  Ripped almost entirely, without shame, [from
  Postgrex](https://github.com/elixir-ecto/postgrex/blob/cd684e7eb25201602c931fab98c9d64e5ae44b2a/lib/postgrex/scram.ex)
  """

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.SASL.SCRAMLockedCache

  require Logger

  defmodule Error do
    defexception [:message]
  end

  @type state() :: {__MODULE__, mechanism :: atom(), state :: map()}

  @hash_length 32
  @nonce_length 24
  @nonce_rand_bytes div(@nonce_length * 6, 8)
  @nonce_prefix "n,,n=,r="

  @spec initial_response(M.AuthenticationSASL.t()) ::
          {state(), M.SASLInitialResponse.t()} | no_return()
  def initial_response(%M.AuthenticationSASL{} = msg) do
    Enum.find_value(msg.mechanisms, &initial_response_mechanism/1) ||
      raise Error, message: "No supported SASL mechanism found #{inspect(msg.mechanisms)}"
  end

  @spec client_final_response(state(), M.AuthenticationSASLContinue.t(), %{password: binary()}) ::
          {state(), M.SASLResponse.t()} | no_return()
  def client_final_response(
        {__MODULE__, mechanism, _state},
        %M.AuthenticationSASLContinue{} = msg,
        connection
      ) do
    server = parse_server_data(msg.data)
    {:ok, server_s} = Base.decode64(server[?s])
    server_i = String.to_integer(server[?i])
    pass = Map.fetch!(connection, :password)
    cache_key = create_cache_key(pass, server_s, server_i)

    {client_key, _server_key} =
      SCRAMLockedCache.run(cache_key, fn ->
        calculate_client_server_keys(pass, server_s, server_i)
      end)

    # Construct client signature and proof
    message_without_proof = ["c=biws,r=", server[?r]]
    client_nonce = binary_part(server[?r], 0, @nonce_length)
    message = ["n=,r=", client_nonce, ",r=", server[?r], ",s=", server[?s], ",i=", server[?i], ?,]
    auth_message = IO.iodata_to_binary([message | message_without_proof])

    client_sig = hmac(:sha256, :crypto.hash(:sha256, client_key), auth_message)
    proof = Base.encode64(:crypto.exor(client_key, client_sig))

    # Store data needed to verify the server signature
    state = %{salt: server_s, iterations: server_i, auth_message: auth_message}

    {{__MODULE__, mechanism, state},
     %M.SASLResponse{data: IO.iodata_to_binary([message_without_proof, ",p=", proof])}}
  end

  @spec verify_server(state(), M.AuthenticationSASLFinal.t(), %{password: binary()}) ::
          :ok | {:error, String.t()}
  def verify_server(
        {__MODULE__, _mechanism, state},
        %M.AuthenticationSASLFinal{} = msg,
        connection
      ) do
    msg.data
    |> parse_server_data()
    |> do_verify_server(state, connection)
  end

  defp initial_response_mechanism("SCRAM-SHA-256") do
    nonce = nonce()
    response = <<@nonce_prefix::binary, nonce::binary>>

    {{__MODULE__, :scram_sha_256, %{nonce: nonce}},
     %M.SASLInitialResponse{
       name: "SCRAM-SHA-256",
       response: response
     }}
  end

  defp initial_response_mechanism(mechanism) do
    Logger.warning("Unsupported SASL mechanism #{inspect(mechanism)}")
    nil
  end

  defp nonce do
    @nonce_rand_bytes |> :crypto.strong_rand_bytes() |> Base.encode64()
  end

  #
  defp do_verify_server(%{?e => server_e}, _scram_state, _conn) do
    {:error,
     %Error{message: "error received in SCRAM server final message: #{inspect(server_e)}"}}
  end

  defp do_verify_server(%{?v => server_v}, state, connection) do
    # Decode server signature from the server-final message
    {:ok, server_sig} = Base.decode64(server_v)

    # Construct expected server signature
    pass = Map.fetch!(connection, :password)
    cache_key = create_cache_key(pass, state.salt, state.iterations)
    {_client_key, server_key} = SCRAMLockedCache.get(cache_key)
    expected_server_sig = hmac(:sha256, server_key, state.auth_message)

    # Verify the server signature sent to us is correct
    if expected_server_sig == server_sig do
      :ok
    else
      {:error, %Error{message: "cannot verify SCRAM server signature"}}
    end
  end

  defp do_verify_server(server, _scram_state, _opts) do
    {:error, %Error{message: "unsupported SCRAM server final message: #{inspect(server)}"}}
  end

  #
  defp parse_server_data(data) do
    for kv <- :binary.split(data, ",", [:global]), into: %{} do
      <<k, "=", v::binary>> = kv
      {k, v}
    end
  end

  #
  defp create_cache_key(pass, salt, iterations) do
    {:crypto.hash(:sha256, pass), salt, iterations}
  end

  defp calculate_client_server_keys(pass, salt, iterations) do
    salted_pass = hash_password(pass, salt, iterations)
    client_key = hmac(:sha256, salted_pass, "Client Key")
    server_key = hmac(:sha256, salted_pass, "Server Key")

    {client_key, server_key}
  end

  defp hash_password(secret, salt, iterations) do
    hash_password(secret, salt, iterations, 1, [], 0)
  end

  defp hash_password(_secret, _salt, _iterations, _block_index, acc, length)
       when length >= @hash_length do
    acc
    |> IO.iodata_to_binary()
    |> binary_part(0, @hash_length)
  end

  defp hash_password(secret, salt, iterations, block_index, acc, length) do
    initial = hmac(:sha256, secret, <<salt::binary, block_index::integer-size(32)>>)
    block = iterate(secret, iterations - 1, initial, initial)
    length = byte_size(block) + length
    hash_password(secret, salt, iterations, block_index + 1, [acc, block], length)
  end

  defp iterate(_secret, 0, _prev, acc), do: acc

  defp iterate(secret, iteration, prev, acc) do
    next = hmac(:sha256, secret, prev)
    iterate(secret, iteration - 1, next, :crypto.exor(next, acc))
  end

  defp hmac(type, key, data), do: :crypto.mac(:hmac, type, key, data)
end
