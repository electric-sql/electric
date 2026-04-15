defmodule Electric.DurableStreams.HttpClient do
  @moduledoc """
  Behaviour for HTTP/2 connections used by SendLoop.

  Production uses `HttpClient.Mint`; tests can use a mock implementation.
  Vendored from durable-replication.
  """

  @type conn_state :: term()
  @type request_ref :: term()

  @type response_event ::
          {:status, request_ref(), non_neg_integer()}
          | {:headers, request_ref(), [{String.t(), String.t()}]}
          | {:data, request_ref(), binary()}
          | {:done, request_ref()}
          | {:error, request_ref(), term()}

  @callback connect(uri :: URI.t(), opts :: keyword()) ::
              {:ok, conn_state()} | {:error, term()}

  @callback request(
              conn_state(),
              method :: String.t(),
              path :: String.t(),
              headers :: [{String.t(), String.t()}],
              body :: binary()
            ) ::
              {:ok, conn_state(), request_ref()}
              | {:error, conn_state(), term()}
              | {:partial, conn_state(), request_ref(), remaining :: binary()}

  @callback stream(conn_state(), message :: term()) ::
              {:ok, conn_state(), [response_event()]}
              | {:error, conn_state(), term(), [response_event()]}
              | :unknown

  @callback close(conn_state()) :: {:ok, conn_state()}
end
