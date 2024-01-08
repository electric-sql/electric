defmodule Electric.Postgres.Types.DateTime do
  def from_epgsql({date, {h, m, frac_sec}}) do
    sec = trunc(frac_sec)
    microsec = trunc((frac_sec - sec) * 1_000_000)
    DateTime.from_naive!(NaiveDateTime.from_erl!({date, {h, m, sec}}, {microsec, 6}), "Etc/UTC")
  end

  def to_epgsql(%DateTime{} = dt) do
    dt |> DateTime.to_naive() |> NaiveDateTime.to_erl()
  end
end
