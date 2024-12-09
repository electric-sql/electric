<script>
import { ref, onMounted, watch, markRaw } from "vue"
import { Chart } from "chart.js/auto"
import benchmarkData from "../../static/data/benchmarks/cdn_perf_benchmark_2024-12-09.json"

function getComputedStyleValue(name) {
  if (typeof window !== "undefined") {
    return window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(name)
  }
}

function formatMetricValue(metricName, value) {
  switch (metricName) {
    case "syncServiceCPU":
    case "postgresCPU":
      return `${value}%`
    case "syncServiceMemory":
    case "postgresMemory":
      return humanizeBytes(value)
    case "syncServiceStorage":
      return humanizeBytes(value)
  }
}

function humanizeBytes(bytes, decimals = 0) {
  if (bytes < 0) throw new Error("Byte value cannot be negative.")
  const units = ["B", "KB", "MB", "GB"]
  const factor = 1024
  if (bytes === 0) return `0 B`
  const index = Math.floor(Math.log(bytes) / Math.log(factor))
  const size = bytes / Math.pow(factor, index)
  return `${size.toFixed(decimals)} ${units[index]}`
}

export default {
  setup() {
    Chart.defaults.color = getComputedStyleValue("--vp-c-text-1")
    Chart.defaults.borderColor = `#ffffff50`
    Chart.defaults.font = {
      ...Chart.defaults.font,
      family: getComputedStyleValue("--vp-font-family-base"),
    }

    const chartCanvas = ref(null)
    const chartInstance = ref(null)

    const latencyOptions = [
      { label: "Latency (min)", value: "latencyMin" },
      { label: "Latency (95th percentile)", value: "latencyP95" },
      { label: "Latency (99th percentile)", value: "latencyP99" },
      { label: "Latency (mean)", value: "latencyMean" },
    ]
    const txRateOptions = Object.keys(benchmarkData)
      .sort()
      .map((key) => ({
        label: `Workload (${parseInt(key)} req/s)`,
        value: key,
      }))

    const metricOptions = [
      { label: "Sync service CPU", value: "syncServiceCPU" },
      { label: "Sync service memory", value: "syncServiceMemory" },
      { label: "Sync service storage", value: "syncServiceStorage" },
      { label: "Postgres CPU", value: "postgresCPU" },
      { label: "Postgres memory", value: "postgresMemory" },
    ].filter((option) => option.value in benchmarkData[txRateOptions[0].value])

    const selectedLatency = ref("latencyP95")
    const selectedTxRate = ref(
      txRateOptions[Math.floor(txRateOptions.length / 2)].value
    )
    const selectedMetric = ref(
      metricOptions[Math.floor(metricOptions.length / 2)].value
    )

    const brandColor1 = getComputedStyleValue("--electric-color")
    const brandColor2 = getComputedStyleValue("--vp-c-brand-1")

    const updateChart = () => {
      if (!chartInstance.value) {
        createChart()
        return
      }
      const data = benchmarkData[selectedTxRate.value]
      const labels = data.clients
      const latencyData = data[selectedLatency.value]
      const metricData = data[selectedMetric.value]

      chartInstance.value.data.labels = labels
      chartInstance.value.data.datasets[0].data = latencyData
      chartInstance.value.data.datasets[1].data = metricData
      chartInstance.value.update()
    }

    const createChart = () => {
      if (chartInstance.value) {
        chartInstance.value.destroy()
      }

      const data = benchmarkData[selectedTxRate.value]
      const labels = data.clients
      const latencyData = data[selectedLatency.value]
      const metricData = data[selectedMetric.value]

      const chart = new Chart(chartCanvas.value, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              data: latencyData,
              borderColor: brandColor1,
              yAxisID: "y1",
              pointStyle: false,
              fill: false,
            },
            {
              data: metricData,
              borderColor: brandColor2,
              yAxisID: "y2",
              pointStyle: false,
              fill: false,
            },
          ],
        },
        options: {
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              enabled: false,
            },
          },
          responsive: true,
          interaction: false,
          scales: {
            x: {
              title: {
                display: true,
                text: "Concurrent Clients",
              },
              min: 0,
              ticks: {
                callback: function (value, _index, _ticks) {
                  const numClients = parseInt(this.getLabelForValue(value))
                  if (numClients === 0) {
                    return `0`
                  } else if (numClients < 1e6) {
                    return `${numClients / 1000}k`
                  } else {
                    return `${numClients / 1e6}M`
                  }
                },
              },
              grid: {
                drawOnChartArea: false,
              },
            },
            y1: {
              type: "linear",
              position: "left",
              min: 0,
              ticks: {
                color: brandColor1,
                callback: function (value, _index, _ticks) {
                  return `${value} ms`
                },
              },
              grid: {
                drawOnChartArea: false,
              },
            },
            y2: {
              type: "linear",
              position: "right",
              min: 0,
              ticks: {
                color: brandColor2,
                callback: function (value, _index, _ticks) {
                  return formatMetricValue(selectedMetric.value, value)
                },
              },
              grid: {
                drawOnChartArea: false,
              },
            },
          },
        },
      })

      chartInstance.value = markRaw(chart)
    }

    onMounted(() => {
      createChart()
    })

    watch([selectedLatency, selectedTxRate, selectedMetric], updateChart)

    return {
      chartCanvas,
      latencyOptions,
      txRateOptions,
      metricOptions,
      selectedLatency,
      selectedTxRate,
      selectedMetric,
    }
  },
}
</script>

<template>
  <div class="ScalabilityGraph">
    <div class="controls">
      <label class="selector latency">
        <select v-model="selectedLatency">
          <option
            v-for="option in latencyOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="selector tx-rate">
        <select v-model="selectedTxRate">
          <option
            v-for="option in txRateOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="selector metric">
        <select v-model="selectedMetric">
          <option
            v-for="option in metricOptions"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>

    <canvas ref="chartCanvas" width="600" height="400"></canvas>
  </div>
</template>

<style>
.ScalabilityGraph {
  border-width: 0.5px;
  border-color: var(--vp-c-border);
  border-style: solid;
  border-radius: 24px;
  background-color: var(--vp-c-bg-soft);
  padding: 16px;
}

.controls {
  display: flex;
  width: 100%;
  justify-content: space-evenly;
  gap: 20px;
  margin-bottom: 16px;
}

.selector {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.selector.latency {
  color: var(--electric-color);
}
.selector.metric {
  color: var(--vp-c-brand-1);
}

.selector select {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px calc(12px + 0.7rem) 2px 8px;
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  background-color: var(--vp-c-bg-elv);

  outline: none;
  -moz-appearance: none;
  -webkit-appearance: none;
  appearance: none;
  appearance: none;
  transition: border-color 0.3s ease;

  background-image: url("data:image/svg+xml;utf8,<svg viewBox='0 0 140 140' width='24' height='24' xmlns='http://www.w3.org/2000/svg'><g><path d='m121.3,34.6c-1.6-1.6-4.2-1.6-5.8,0l-51,51.1-51.1-51.1c-1.6-1.6-4.2-1.6-5.8,0-1.6,1.6-1.6,4.2 0,5.8l53.9,53.9c0.8,0.8 1.8,1.2 2.9,1.2 1,0 2.1-0.4 2.9-1.2l53.9-53.9c1.7-1.6 1.7-4.2 0.1-5.8z' fill='white'/></g></svg>");
  background-repeat: no-repeat;
  background-position: right 0.35rem top 50%;
  background-size: 0.7rem auto;
}

.selector select:hover {
  border-color: var(--vp-c-white);
}

.selector select:focus {
  border-color: var(--vp-c-white);
}
</style>
