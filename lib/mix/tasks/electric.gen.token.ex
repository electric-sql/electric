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

  * `--ttl` - the time to life of the token, in seconds. Defaults to 1 year

  * `--format FORMAT` - choose output format, either `json` or `csv`. If no format is specified,
    then output a human readable summary.

  * `--output` - write the token information to a file, not stdout

  If `--output` is specified then the default format will be one comma-separated user id, token
  and expiry per line.
  """

  # these tokens are for testing so give them a long exipry
  @default_ttl_seconds 3600 * 24 * 365
  @valid_formats ~w(json csv)

  def run(argv) do
    Logger.configure_backend(:console, level: :error)

    {args, user_ids, _} =
      OptionParser.parse(argv, strict: [ttl: :integer, format: :string, output: :string])

    format = Keyword.get(args, :format, nil)

    if format && format not in @valid_formats do
      Mix.Shell.IO.error("Invalid format '#{format}'")
      System.halt(1)
    end

    path = args[:output]
    # if we're writing to a file, default to csv format
    default_text_format = if path, do: "csv", else: "cli"
    format = String.to_existing_atom(format || default_text_format)
    ttl = Keyword.get(args, :ttl, @default_ttl_seconds)
    expiry = DateTime.add(DateTime.utc_now(), ttl, :second)

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

    if path do
      File.write!(path, IO.ANSI.format(output, false))
      Mix.Shell.IO.info(["Written token information to ", :green, path])
    else
      Mix.Shell.IO.info(["\n" | output])
    end
  end

  def default_ttl do
    @default_ttl_seconds
  end

  @spec format_tokens([map()], atom) :: IO.ANSI.ansilist()
  defp format_tokens(tokens, :cli) do
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

  defp format_tokens(tokens, :csv) do
    sep = ","

    for %{user_id: user_id, token: token, expiry: expiry} <- tokens do
      [user_id, sep, token, sep, DateTime.to_iso8601(expiry), "\n"]
    end
  end

  defp format_tokens(tokens, :json) do
    Application.ensure_all_started(:jason)

    Jason.encode!(
      Map.new(tokens, fn %{user_id: user_id, token: token, expiry: expiry} ->
        {user_id, %{token: token, expiry: expiry}}
      end),
      pretty: true
    )
  end
end
