defmodule Mix.Tasks.Electric.Gen.Token do
  use Mix.Task

  @shortdoc "Generate an authentication token"
  @moduledoc """
  Generate an authentication token for the given user ids.

  This requires the application to be configured for JWT authentication with the required
  environment variables set, i.e. `SATELLITE_AUTH_SIGNING_KEY` and `SATELLITE_AUTH_SIGNING_ISS`.
  See the README under "Environment Variables".

  ## Usage

      mix electric.gen.token USER_ID

  Where `USER_ID` is the user id who you'd like to generate the token for.

  ## Command line options

  * `--lifetime` - the lifetime of the token, in seconds. Defaults to 1 year

  * `--json` - output the token details in JSON format

  * `--output` - write the token information to a file, not stdout

  """

  # these tokens are for testing so give them a long exipry
  @default_lifetime_seconds 3600 * 24 * 365

  def run(argv) do
    Logger.configure_backend(:console, level: :error)

    {args, user_ids, _} =
      OptionParser.parse(argv, strict: [lifetime: :integer, json: :boolean, output: :string])

    lifetime = Keyword.get(args, :lifetime, @default_lifetime_seconds)
    format = if Keyword.get(args, :json, false), do: :json, else: :txt

    expiry = DateTime.add(DateTime.utc_now(), lifetime, :second)

    tokens =
      for user_id <- user_ids do
        case Electric.Satellite.Auth.JWT.generate_token(user_id, expiry: DateTime.to_unix(expiry)) do
          {:ok, token} ->
            %{token: token, user_id: user_id, expiry: expiry}

          {:error, reason} ->
            Mix.Shell.IO.error(reason)
            System.halt(1)
        end
      end

    output = format_tokens(tokens, format)

    if path = args[:output] do
      File.write!(path, IO.ANSI.format(output, false))
      Mix.Shell.IO.info(["written token information to ", :green, path])
    else
      Mix.Shell.IO.info(["\n" | output])
    end
  end

  @spec format_tokens([map()], atom) :: IO.ANSI.ansilist()
  def format_tokens(tokens, :txt) do
    for %{user_id: user_id, token: token, expiry: expiry} <- tokens do
      [
        "user id: ",
        :bright,
        user_id,
        :reset,
        "\n  token: ",
        :green,
        token,
        :reset,
        "\nexpiry: ",
        to_string(expiry),
        "\n\n"
      ]
    end
  end

  def format_tokens(tokens, :json) do
    Application.ensure_all_started(:jason)

    Jason.encode!(
      Map.new(tokens, fn %{user_id: user_id, token: token, expiry: expiry} ->
        {user_id, %{token: token, expiry: expiry}}
      end),
      pretty: true
    )
  end
end
