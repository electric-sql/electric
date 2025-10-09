<script>
import { ref, onMounted, markRaw, watch, computed, onUnmounted } from 'vue'
import { Chart } from 'chart.js/auto'
import { LogarithmicScale } from 'chart.js'

function getComputedStyleValue(name) {
  if (typeof window !== 'undefined') {
    return window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(name)
  }
}

export default {
  props: {
    title: { type: String, required: true },
    // Each item: { label: string, data: number[], color?: string, yAxisID?: string }
    data: { type: Array, required: true },
    labels: { type: Array, required: true },
    xAxisTitle: { type: String, default: 'X Axis' },
    yAxisTitle: { type: String, default: 'Y Axis' },
    yAxisSuffix: { type: String, default: '' },
    yScaleType: {
      type: String,
      default: 'linear',
      validator: (v) => ['linear', 'logarithmic'].includes(v),
    },
    // Second Y-axis props
    y2AxisTitle: { type: String, default: '' },
    y2AxisSuffix: { type: String, default: '' },
    y2ScaleType: {
      type: String,
      default: 'linear',
      validator: (v) => ['linear', 'logarithmic'].includes(v),
    },
    // Compute and display speedup = old / new for each x index using these dataset labels
    speedupNewLabel: { type: String, default: '' },
    speedupOldLabel: { type: String, default: '' },
    // Raw data for annotations
    rawData: { type: Object, default: () => ({}) },
    columns: { type: Number, default: 1 },
    height: { type: [Number, String], default: 320 },
  },
  setup(props) {
    // Ensure logarithmic scale is registered even when using chart.js/auto
    try {
      Chart.register(LogarithmicScale)
    } catch (_) {}
    Chart.defaults.color = getComputedStyleValue('--vp-c-text-1')
    Chart.defaults.borderColor = `#ffffff50`
    Chart.defaults.font = {
      ...Chart.defaults.font,
      family: getComputedStyleValue('--vp-font-family-base'),
    }

    const chartCanvas = ref(null)
    const chartInstance = ref(null)
    const wrapperEl = ref(null)

    const brandColor1 = getComputedStyleValue('--electric-color')
    const brandColor2 = getComputedStyleValue('--vp-c-brand-1')
    const brandColor3 = getComputedStyleValue('--vp-c-brand-2')
    const brandColor4 = getComputedStyleValue('--vp-c-brand-3')

    // Responsive width handling based on columns prop
    const widthValue = ref('100%')
    const updateWidth = () => {
      if (typeof window === 'undefined') return
      if (props.columns <= 1) {
        widthValue.value = '100%'
        return
      }
      const w = window.innerWidth
      if (w < 860) {
        widthValue.value = '100%'
      } else {
        const pct = (100 / props.columns).toFixed(3)
        widthValue.value = `calc(${pct}% - 12px)`
      }
    }

    const heightValue = computed(() =>
      typeof props.height === 'number' ? `${props.height}px` : props.height
    )
    const wrapperStyle = computed(() => ({
      width: widthValue.value,
      height: heightValue.value,
    }))

    const createChart = () => {
      if (chartInstance.value) {
        chartInstance.value.destroy()
      }

      const defaultColors = [brandColor1, brandColor2, brandColor3, brandColor4]

      const datasets = props.data.map((dataset, index) => {
        const baseColor =
          dataset.color || defaultColors[index % defaultColors.length]
        return {
          label: dataset.label,
          data: dataset.data,
          backgroundColor: baseColor,
          borderColor: baseColor,
          borderWidth: 1,
          order: index + 1,
          yAxisID: dataset.yAxisID || 'y', // Default to 'y' if not specified
        }
      })

      const chartData = { labels: props.labels, datasets }

      // Limit ticks on logarithmic scale to powers of 10 within range
      const logTicksLimiterPlugin = {
        id: 'logTicksLimiter',
        afterBuildTicks: (scale) => {
          if (scale.id !== 'y' || scale.type !== 'logarithmic') return
          const min = Math.max(1e-12, scale.min || 1)
          const max = scale.max || 1
          const minExp = Math.floor(Math.log10(min))
          const maxExp = Math.ceil(Math.log10(max))
          const ticks = []
          for (let e = minExp; e <= maxExp; e += 1) {
            ticks.push(Math.pow(10, e))
          }
          // Fallback in edge cases
          if (ticks.length > 0) {
            scale.ticks = ticks.map((v) => ({ value: v }))
          }
        },
      }

      // Plugin to render speedup labels and actual latency annotations
      const speedupLabelsPlugin = {
        id: 'speedupLabels',
        afterDatasetsDraw: (chart) => {
          const newLabel = (props.speedupNewLabel || '').trim()
          const oldLabel = (props.speedupOldLabel || '').trim()
          if (!newLabel || !oldLabel) return
          const dataLabels = chart.data?.labels
          const datasetsArr = chart.data?.datasets || []
          if (!Array.isArray(dataLabels) || datasetsArr.length < 2) return
          const idxNew = datasetsArr.findIndex(
            (d) =>
              d && typeof d.label === 'string' && d.label.trim() === newLabel
          )
          const idxOld = datasetsArr.findIndex(
            (d) =>
              d && typeof d.label === 'string' && d.label.trim() === oldLabel
          )
          if (idxNew < 0 || idxOld < 0) return
          const dataNew = datasetsArr[idxNew]?.data || []
          const dataOld = datasetsArr[idxOld]?.data || []
          const metaNew = chart.getDatasetMeta(idxNew)
          const metaOld = chart.getDatasetMeta(idxOld)

          // Actual latency values for annotation
          const actualLatencies = props.rawData

          const ctx = chart.ctx
          ctx.save()
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.fillStyle = getComputedStyleValue('--vp-c-text-2') || '#666'
          ctx.font = `${Chart.defaults.font.size || 12}px ${Chart.defaults.font.family || 'sans-serif'}`
          const n = Array.isArray(dataLabels) ? dataLabels.length : 0
          for (let i = 0; i < n; i += 1) {
            const vNew = Number(dataNew[i])
            const vOld = Number(dataOld[i])
            if (!isFinite(vNew) || !isFinite(vOld) || vNew <= 0 || vOld <= 0)
              continue
            const speedup = vOld / vNew
            if (!isFinite(speedup) || speedup <= 0) continue
            const elNew = metaNew?.data?.[i]
            const elOld = metaOld?.data?.[i]
            if (!elNew || !elOld) continue

            // Place latency above the 1.0.24 bar
            const oldLatency = actualLatencies['1.0.24']?.[i]
            if (oldLatency !== undefined) {
              const oldText = `${oldLatency.toFixed(oldLatency >= 100 ? 0 : oldLatency >= 1 ? 1 : 2)}ms`
              ctx.fillText(oldText, elOld.x, elOld.y - 6)
            }

            // Place latency and speedup above the 1.1.0 bar
            const newLatency = actualLatencies['1.1.0']?.[i]
            if (newLatency !== undefined) {
              const newText = `${newLatency.toFixed(newLatency >= 100 ? 0 : newLatency >= 1 ? 1 : 2)}ms`
              const speedupText = `×${speedup.toFixed(speedup >= 10 ? 0 : speedup >= 3 ? 1 : 2)}`

              // Draw latency on first line
              ctx.fillText(newText, elNew.x, elNew.y - 20)
              // Draw speedup on second line
              ctx.fillText(speedupText, elNew.x, elNew.y - 6)
            }
          }
          ctx.restore()
        },
      }

      const chart = new Chart(chartCanvas.value, {
        type: 'bar',
        data: chartData,
        plugins: [logTicksLimiterPlugin, speedupLabelsPlugin],
        options: {
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: {
                color: getComputedStyleValue('--vp-c-text-2'),
                padding: 14,
                filter: (legendItem, chartData) => {
                  // Deduplicate legend items with the same label
                  const label = legendItem.text
                  const firstIndex = chartData.datasets.findIndex(
                    (dataset) => dataset.label === label
                  )
                  return legendItem.datasetIndex === firstIndex
                },
              },
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                title: (context) => `${props.xAxisTitle}: ${context[0].label}`,
                label: (context) => {
                  // Only show tooltip for non-null values
                  if (context.raw === null || context.raw === undefined)
                    return null

                  // Get raw latency value for this dataset and data point
                  const datasetLabel = context.dataset.label
                  const dataIndex = context.dataIndex
                  const rawLatency = props.rawData[datasetLabel]?.[dataIndex]

                  if (rawLatency !== undefined) {
                    const base = `${context.dataset.label}: ${rawLatency.toFixed(rawLatency >= 100 ? 0 : rawLatency >= 1 ? 1 : 2)}ms`
                    // Append inline speedup only on the new/faster dataset line
                    const newLabel = (props.speedupNewLabel || '').trim()
                    const oldLabel = (props.speedupOldLabel || '').trim()
                    if (!newLabel || !oldLabel) return base
                    if (
                      typeof context.dataset.label !== 'string' ||
                      context.dataset.label.trim() !== newLabel
                    )
                      return base
                    const chart = context.chart
                    const datasetsArr = chart?.data?.datasets || []
                    const iNew = datasetsArr.findIndex(
                      (d) =>
                        d &&
                        typeof d.label === 'string' &&
                        d.label.trim() === newLabel
                    )
                    const iOld = datasetsArr.findIndex(
                      (d) =>
                        d &&
                        typeof d.label === 'string' &&
                        d.label.trim() === oldLabel
                    )
                    if (iNew < 0 || iOld < 0) return base
                    const vNew = Number(datasetsArr[iNew]?.data?.[dataIndex])
                    const vOld = Number(datasetsArr[iOld]?.data?.[dataIndex])
                    if (
                      !isFinite(vNew) ||
                      !isFinite(vOld) ||
                      vNew <= 0 ||
                      vOld <= 0
                    )
                      return base
                    const speedup = vOld / vNew
                    if (!isFinite(speedup) || speedup <= 0) return base
                    const text = ` (×${speedup.toFixed(speedup >= 10 ? 0 : speedup >= 3 ? 1 : 2)} faster)`
                    return base + text
                  }

                  // Fallback to normalized value if raw data not available
                  const base = `${context.dataset.label}: ${context.raw}${props.yAxisSuffix}`
                  return base
                },
              },
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          resizeDelay: 40,
          interaction: { mode: 'index', intersect: false },
          hover: { mode: 'index', intersect: false },
          barPercentage: 0.8,
          categoryPercentage: 0.9,
          layout: {
            padding: {
              top: 30,
              bottom: 20,
              left: 20,
              right: 20,
            },
          },
          scales: {
            x: {
              title: { display: false },
              grid: { drawOnChartArea: false },
              stacked: false,
            },
            y: {
              display: false,
            },
          },
        },
      })

      chartInstance.value = markRaw(chart)
    }

    onMounted(() => {
      updateWidth()
      window.addEventListener('resize', updateWidth)
      createChart()
    })

    onUnmounted(() => {
      window.removeEventListener('resize', updateWidth)
    })

    watch(
      [() => props.data, () => props.labels],
      () => {
        createChart()
      },
      { deep: true }
    )

    return { chartCanvas, wrapperEl, wrapperStyle }
  },
}
</script>

<template>
  <div class="StorageComparisonGraph" ref="wrapperEl" :style="wrapperStyle">
    <h3>{{ title }}</h3>
    <canvas ref="chartCanvas"></canvas>
  </div>
</template>

<style scoped>
.StorageComparisonGraph {
  width: 100%;
  position: relative;
  display: block;
  box-sizing: border-box;
}

@media (max-width: 860px) {
  .StorageComparisonGraph {
    width: 100% !important;
  }
}

.StorageComparisonGraph h3 {
  text-align: center;
  margin-bottom: 0.5rem;
  color: var(--vp-c-text-1);
  font-size: 1.05rem;
  font-weight: 600;
}
</style>
