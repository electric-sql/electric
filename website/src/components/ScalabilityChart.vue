<script>
import { ref, onMounted, markRaw } from "vue"
import { Chart } from "chart.js/auto"
import benchmarkData from "../../static/data/benchmarks/cdn_perf_benchmark_2024-12-09.json"

function getComputedStyleValue(name) {
  if (typeof window !== "undefined") {
    return window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(name)
  }
}

function humanizeBytes(bytes) {
  if (bytes < 0) throw new Error("Byte value cannot be negative.")
  const units = ["B", "KB", "MB", "GB"]
  const factor = 1024
  if (bytes === 0) return `0 B`
  const index = Math.floor(Math.log(bytes) / Math.log(factor))
  const size = bytes / Math.pow(factor, index)
  return `${Math.round(size)} ${units[index]}`
}

function formatClients(numClients) {
  if (numClients === 0) {
    return '0'
  } else if (numClients < 1e6) {
    return `${numClients / 1000}k`
  } else {
    return `${numClients / 1e6}M`
  }
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

    const brandColor1 = getComputedStyleValue("--electric-color")
    const brandColor2 = getComputedStyleValue("--vp-c-brand-1")
    const brandColor3 = getComputedStyleValue("--vp-c-brand-2")
    const brandColor4 = getComputedStyleValue("--vp-c-brand-3")

    const createChart = () => {
      if (chartInstance.value) {
        chartInstance.value.destroy()
      }

      // Get data for 960 writes/min (16 writes/sec)
      const data = benchmarkData["16"]
      const labels = data.clients
      const meanData = data.latencyMean
      const p95Data = data.latencyP95
      const p99Data = data.latencyP99
      const memoryData = data.syncServiceMemory

      const latencyColor = brandColor1
      const memoryColor = brandColor2

      const chart = new Chart(chartCanvas.value, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Mean latency",
              data: meanData,
              borderColor: latencyColor,
              borderWidth: 1.5,
              backgroundColor: 'transparent',
              padding: 20,
              pointStyle: false,
              fill: false,
              yAxisID: 'y',
              order: 1,
            },
            // {
            //   label: "P95",
            //   data: p95Data,
            //   borderColor: latencyColor,
            //   borderWidth: 1.5,
            //   backgroundColor: 'transparent',
            //   borderDash: [5, 5],
            //   pointStyle: false,
            //   fill: false,
            //   yAxisID: 'y',
            //   order: 2,
            // },
            {
              label: "P99",
              data: p99Data,
              borderWidth: 1.5,
              borderColor: latencyColor,
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              borderDash: [2, 2],
              pointStyle: false,
              fill: false,
              yAxisID: 'y',
              order: 3,
            },
            {
              label: "Memory use",
              data: memoryData,
              borderColor: memoryColor,
              borderWidth: 1.5,
              backgroundColor: 'transparent',
              pointStyle: false,
              fill: false,
              yAxisID: 'y1',
              order: 4,
            },
          ],
        },
        options: {
          plugins: {
            legend: {
              display: true,
              position: "top",
              // onClick: null, // Disable toggling datasets
              labels: {
                color: getComputedStyleValue("--vp-c-text-2"),
                usePointStyle: false,
                padding: 14
              }
            },
            tooltip: {
              enabled: false,
              mode: 'index',
              intersect: false,
              callbacks: {
                title: (context) => {
                  return `Clients: ${formatClients(parseInt(context[0].label))}`
                },
                label: (context) => {
                  if (context.dataset.yAxisID === 'y1') {
                    return `${context.dataset.label}: ${humanizeBytes(context.raw)}`
                  }
                  return `${context.dataset.label}: ${context.raw} ms`
                },
              },
            },
            crosshair: {
              line: {
                color: '#ffffff40',
                width: 1,
              },
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          onResize: (chart, size) => {
            chart.canvas.parentNode.style.height = 'max(min(384px, 33vw), 280px)';
            chart.canvas.parentNode.style.width = `100%`;

            let hasChanged = false

            if (size.width < 500) {
              if (chart.data.datasets[0].label !== 'Mean') {
                hasChanged = true
              }

              chart.data.datasets[0].label = 'Mean'
              chart.data.datasets[2].label = 'Memory'
            }
            else {
              if (chart.data.datasets[0].label !== 'Mean latency') {
                hasChanged = true
              }

              chart.data.datasets[0].label = 'Mean latency'
              chart.data.datasets[2].label = 'Memory use'
            }

            if (size.width < 650) {
              if (chart.data.datasets[1].label !== 'P99') {
                hasChanged = true
              }

              chart.data.datasets[1].label = 'P99'
            }
            else {
              if (chart.data.datasets[1].label !== 'P95 latency') {
                hasChanged = true
              }

              chart.data.datasets[1].label = 'P99 latency'
            }

            if (hasChanged) {
              chart.update()
            }
          },
          aspectRatio: 16 / 10,
          resizeDelay: 40,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          hover: {
            mode: 'index',
            intersect: false,
          },
          elements: {
            point: {
              radius: 0,
            },
          },
          cursor: {
            mode: 'vertical',
            color: '#ffffff40',
          },
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
                  return formatClients(numClients)
                },
              },
              grid: {
                drawOnChartArea: false,
              },
            },
            y: {
              type: "linear",
              position: "left",
              min: 0,
              title: {
                display: true,
                text: "Latency (ms)",
              },
              ticks: {
                callback: (value) => `${value} ms`,
              },
              grid: {
                color: "#ffffff20",
              },
            },
            y1: {
              type: "linear",
              position: "right",
              min: 0,
              title: {
                display: true,
                text: "Memory use",
              },
              ticks: {
                callback: (value) => humanizeBytes(value),
              },
              grid: {
                display: false,
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

    return {
      chartCanvas,
    }
  },
}
</script>

<template>
  <div class="ScalabilityGraph">
    <canvas ref="chartCanvas"></canvas>
  </div>
</template>

<style scoped>
.ScalabilityGraph {
  width: 100%;
  position: relative;
  display: block;
  aspect-ratio: 16 / 9;
}
</style>
