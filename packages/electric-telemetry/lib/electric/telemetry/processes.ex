defmodule ElectricTelemetry.Processes do
  @type limit ::
          {:count, pos_integer()} | {:mem_percent, 1..100} | {:at_least_bytes, non_neg_integer()}

  @default_count 5
  @default_limit {:count, @default_count}
  @initial_call_key :"$initial_call"
  @ancestors_key :"$ancestors"
  @proc_type_info_items [
    :label,
    {:dictionary, @initial_call_key},
    {:dictionary, @ancestors_key},
    :initial_call,
    :registered_name
  ]
  @expanded_info_items @proc_type_info_items ++ [:memory, :binary]

  # Minimum memory threshold for a process group when using :mem_percent mode.
  @min_group_memory 1024 * 1024

  defguardp is_valid_mem_percent(percent)
            when is_integer(percent) and percent >= 1 and percent <= 100

  def validate_mem_percent(percent) do
    if is_valid_mem_percent(percent) do
      {:ok, percent}
    else
      {:error, "mem_percent value must be between 1 and 100, got: #{inspect(percent)}"}
    end
  end

  @doc """
  Derive a stable, low-cardinality `process_type` for a pid.
  """
  @spec proc_type(pid()) :: atom() | binary()
  def proc_type(pid), do: proc_type(pid, info(pid, false))

  def top_memory_by_type, do: top_by(:proc_mem)
  def top_memory_by_type(proc_list_or_limit), do: top_by(:proc_mem, proc_list_or_limit)
  def top_memory_by_type(proc_list, limit), do: top_by(:proc_mem, proc_list, limit)

  def top_bin_memory_by_type, do: top_by(:binary_mem)
  def top_bin_memory_by_type({_, _} = limit), do: top_by(:binary_mem, limit)
  def top_bin_memory_by_type(proc_list_or_limit), do: top_by(:binary_mem, proc_list_or_limit)
  def top_bin_memory_by_type(proc_list, limit), do: top_by(:binary_mem, proc_list, limit)

  def top_by(sort_key), do: top_by(sort_key, Process.list(), @default_limit)
  def top_by(sort_key, {_, _} = limit), do: top_by(sort_key, Process.list(), limit)

  def top_by(sort_key, proc_list) when is_list(proc_list),
    do: top_by(sort_key, proc_list, @default_limit)

  defp top_by(sort_key, process_list, {:count, count})
       when is_integer(count) and count > 0 do
    process_list
    |> sorted_groups(sort_key)
    |> Enum.take(count)
  end

  # When sorting by binary mem, processes double-count the same refc binary, so it doesn't
  # make sense to talk about a "percentage of the total" in that case.
  # Instead, for binary memory telemetry the low cutoff threshold should be provided.
  defp top_by(:proc_mem, process_list, {:mem_percent, percent})
       when is_valid_mem_percent(percent) do
    # :processes_used excludes memory allocated but not yet used by process heaps,
    # giving a more accurate baseline for the percentage calculation.
    total_process_memory = :erlang.memory(:processes_used)
    target = total_process_memory * percent / 100

    process_list
    |> sorted_groups(:proc_mem)
    |> take_until_target(:proc_mem, target, @min_group_memory)
  end

  defp top_by(sort_key, process_list, {:at_least_bytes, low_cutoff})
       when is_integer(low_cutoff) and low_cutoff >= 0 do
    process_list
    |> sorted_groups(sort_key)
    |> take_until_target(sort_key, :infinity, low_cutoff)
  end

  defp sorted_groups(process_list, sort_key) do
    process_list
    |> Enum.map(&type_and_memory/1)
    |> Enum.reject(&(&1.type == :dead))
    |> Enum.group_by(& &1.type)
    |> Enum.map(fn {type, proc_infos} ->
      proc_infos
      |> mem_stats_for_procs()
      |> Map.put(:type, type)
    end)
    |> Enum.sort_by(&(-Map.fetch!(&1, sort_key)))
  end

  defp take_until_target(proc_groups, sort_key, target, low_cutoff) do
    {_running_total, selected_groups} =
      Enum.reduce_while(proc_groups, {0, []}, fn
        _proc_group, {running_total, acc} when running_total >= target ->
          {:halt, {running_total, acc}}

        proc_group, {running_total, acc} ->
          value = Map.fetch!(proc_group, sort_key)

          if value < low_cutoff do
            # Include this last process group in the result so it's clear to the caller that the
            # low cutoff threshold has been reached earlier than the target total mem one.
            {:halt, {running_total, [proc_group | acc]}}
          else
            {:cont, {running_total + value, [proc_group | acc]}}
          end
      end)

    Enum.reverse(selected_groups)
  end

  defp mem_stats_for_procs(proc_infos) when is_list(proc_infos) do
    {proc_mem, binary_mem, max_ref_count, ref_count_sum, max_num_binaries, num_binaries,
     num_procs} =
      Enum.reduce(proc_infos, {0, 0, 0, 0, 0, 0, 0}, fn map,
                                                        {proc_mem, binary_mem, max_ref_count,
                                                         ref_count_sum, max_num_binaries,
                                                         num_binaries, num_procs} ->
        {
          proc_mem + map.proc_mem,
          binary_mem + map.binary_mem,
          max(max_ref_count, map.max_ref_count),
          ref_count_sum + map.ref_count_sum,
          max(max_num_binaries, map.num_binaries),
          num_binaries + map.num_binaries,
          num_procs + 1
        }
      end)

    %{
      proc_mem: proc_mem,
      binary_mem: binary_mem,
      max_bin_count: max_num_binaries,
      avg_bin_count: num_binaries / num_procs,
      max_ref_count: max_ref_count,
      avg_ref_count: if(num_binaries == 0, do: 0, else: ref_count_sum / num_binaries)
    }
  end

  defp type_and_memory(pid) do
    info = info(pid)
    type = proc_type(pid, info)

    info
    |> memory_from_info()
    |> Map.put(:type, type)
  end

  defp info(pid, expanded? \\ true) do
    Process.info(pid, if(expanded?, do: @expanded_info_items, else: @proc_type_info_items))
  end

  defp proc_type(pid, info) do
    type =
      label_from_info(info) ||
        initial_module_from_info(info) ||
        if(Process.alive?(pid), do: :unknown, else: :dead)

    refine_type(type, info)
  end

  defp refine_type(type, info) when type in [:erlang, :supervisor] do
    registered_name(info) || ancestor_name(info) || initial_call_mfa_string(info) || type
  end

  # Logger handler and proxy processes all share the `:logger_olp` type. The handler id
  # (the process's registered name) distinguishes them and is low-cardinality, so we fold
  # it into the type as `"logger_olp:<handler_id>"`, falling back to the coarse type when
  # the process is unnamed.
  defp refine_type(:logger_olp, info) do
    case registered_name(info) do
      nil -> :logger_olp
      name -> "logger_olp:#{name}"
    end
  end

  defp refine_type(type, _info), do: type

  defp registered_name(info) do
    # Process.info(pid, :registered_name) returns an empty list for unregistered processes
    with [] <- info[:registered_name], do: nil
  end

  defp ancestor_name(info) do
    case dictionary_value(info, @ancestors_key) do
      [name | _] when is_atom(name) and not is_nil(name) -> name
      _ -> nil
    end
  end

  defp initial_call_mfa_string(info) do
    # Prefer the dictionary-stored $initial_call (set by proc_lib for OTP processes),
    # falling back to the raw initial_call reported by the VM. Returns "Module.fun/arity".
    mfa =
      case dictionary_value(info, @initial_call_key) do
        {m, f, a} -> {m, f, a}
        _ -> info[:initial_call]
      end

    case mfa do
      {m, f, a} when is_atom(m) and is_atom(f) and is_integer(a) ->
        Exception.format_mfa(m, f, a)

      _ ->
        nil
    end
  end

  defp label_from_info(info) do
    case info[:label] do
      :undefined -> nil
      {name, _} -> name
      {name, _, _} -> name
      name when is_atom(name) -> name
      name when is_binary(name) -> parse_binary_label(name)
      _ -> nil
    end
  end

  defp initial_module_from_info(info) do
    case initial_call_from_dictionary(info) do
      {module, _function, _arg_count} ->
        module

      _ ->
        case info[:initial_call] do
          {module, _function, _arg_count} -> module
          nil -> nil
        end
    end
  end

  defp initial_call_from_dictionary(info) do
    dictionary_value(info, @initial_call_key)
  end

  defp dictionary_value(nil, _key), do: nil

  defp dictionary_value(info, key) do
    case List.keyfind(info, {:dictionary, key}, 0) do
      {{:dictionary, ^key}, value} ->
        value

      nil ->
        get_in(info, [:dictionary, key])
    end
  end

  defp memory_from_info(info) do
    memory =
      case info[:memory] do
        bytes when is_integer(bytes) -> bytes
        _ -> 0
      end

    case info[:binary] do
      list when is_list(list) ->
        {binary_mem, max_ref_count, ref_count_sum, num_entries} =
          Enum.reduce(list, {0, 0, 0, 0}, fn {_reference, bin_size, bin_ref_count},
                                             {binary_mem, max_ref_count, ref_count_sum,
                                              num_entries} ->
            {
              binary_mem + bin_size,
              max(max_ref_count, bin_ref_count),
              ref_count_sum + bin_ref_count,
              num_entries + 1
            }
          end)

        %{
          proc_mem: memory,
          binary_mem: binary_mem,
          max_ref_count: max_ref_count,
          ref_count_sum: ref_count_sum,
          num_binaries: num_entries
        }

      _ ->
        %{proc_mem: memory, binary_mem: 0, max_ref_count: 0, ref_count_sum: 0, num_binaries: 0}
    end
  end

  defp parse_binary_label(label) do
    case label do
      "Request " <> <<_req_id::binary-20, " - ", rest::binary>> ->
        # Fast path: the request id is exactly 20 bytes, as generated by Plug.RequestId.
        # This is a request process with the label assigned by Electric.Plug.LabelProcessPlug.
        # We group all requests together to be able to see their aggregated mem footprint.
        parse_request_label(rest)

      "Request " <> rest ->
        # Slow path: the request id has a non-default length (e.g. a UUID or a proxy-supplied
        # x-request-id), so the fixed-width match above failed. Split on the " - " delimiter
        # instead so all requests to a route collapse to a single label regardless of id length.
        case :binary.split(rest, " - ") do
          [_req_id, request] -> parse_request_label(request)
          _ -> truncate_label(label)
        end

      _ ->
        truncate_label(label)
    end
  end

  defp parse_request_label(request) do
    # Cut off the URL query part, leaving only the `<method> <path>` prefix.
    part_len =
      case :binary.match(request, "?") do
        {pos, _} ->
          pos

        :nomatch ->
          # No query string means only path is present. It is either a request to the health endpoint or something unexpected.
          byte_size(request)
      end

    :binary.part(request, 0, part_len)
  end

  defp truncate_label(label) do
    # Opportunistic grouping by truncating long labels.
    part_len = min(20, byte_size(label))
    :binary.part(label, 0, part_len)
  end
end
