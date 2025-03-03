defmodule Electric.Antithesis do
  require Logger
  @ready_signal ~s|{"antithesis_setup": { "status": "complete", "details": null }}|

  def signal_readiness do
    with dir when dir != nil <- System.get_env("ANTITHESIS_OUTPUT_DIR") do
      dir
      |> Path.join("sdk.jsonl")
      |> File.write!(@ready_signal <> "\n", [:append])

      Logger.notice("Antithesis readiness signal written to #{dir}")
    else
      _ -> Logger.debug("ANTITHESIS_OUTPUT_DIR not set, skipping readiness signal")
    end
  end
end
