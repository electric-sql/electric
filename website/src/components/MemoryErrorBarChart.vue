<script>
import { ref, onMounted, onUnmounted, markRaw, watch, computed } from 'vue'
import { Chart } from 'chart.js/auto'

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
    // Each item: { label: string, p50: number[], peak: number[], color?: string }
    data: { type: Array, required: true },
    labels: { type: Array, required: true },
    xAxisTitle: { type: String, default: '' },
    yAxisTitle: { type: String, default: '' },
    yAxisSuffix: { type: String, default: '' },
    yScaleType: {
      type: String,
      default: 'linear',
      validator: (v) => ['linear', 'logarithmic'].includes(v),
    },
    height: { type: [Number, String], default: 320 },
  },
  setup(props) {
    Chart.defaults.color = getComputedStyleValue('--vp-c-text-1')
    Chart.defaults.borderColor = getComputedStyleValue('--vp-c-divider')

    const chartCanvas = ref(null)
    const chartInstance = ref(null)

    const defaultColors = [
      getComputedStyleValue('--electric-color'),
      getComputedStyleValue('--vp-c-brand-1'),
      getComputedStyleValue('--vp-c-brand-2'),
      getComputedStyleValue('--vp-c-brand-3'),
    ]

    const heightValue = computed(() =>
      typeof props.height === 'number' ? `${props.height}px` : props.height
    )
    const wrapperStyle = computed(() => ({ height: heightValue.value }))

    // Draw a whisker from each bar (p50) up to its peak, with a top cap.
    const errorBarPlugin = {
      id: 'memoryErrorBars',
      afterDatasetsDraw(chart) {
        const { ctx } = chart
        const yScale = chart.scales.y
        ctx.save()
        ctx.lineWidth = 1.5
        props.data.forEach((dataset, di) => {
          const meta = chart.getDatasetMeta(di)
          if (meta.hidden) return
          const peaks = dataset.peak || []
          const p50s = dataset.p50 || []
          meta.data.forEach((bar, bi) => {
            const peak = peaks[bi]
            const p50 = p50s[bi]
            if (peak == null || p50 == null || peak <= p50) return
            const x = bar.x
            const yTop = yScale.getPixelForValue(peak)
            const yBottom = bar.y // top of the bar == p50 position
            ctx.strokeStyle =
              dataset.color || defaultColors[di % defaultColors.length]
            ctx.beginPath()
            ctx.moveTo(x, yBottom)
            ctx.lineTo(x, yTop)
            ctx.stroke()
            const cap = Math.min(bar.width * 0.35, 7)
            ctx.beginPath()
            ctx.moveTo(x - cap, yTop)
            ctx.lineTo(x + cap, yTop)
            ctx.stroke()
          })
        })
        ctx.restore()
      },
    }

    const createChart = () => {
      if (chartInstance.value) chartInstance.value.destroy()

      const datasets = props.data.map((dataset, index) => ({
        label: dataset.label,
        data: dataset.p50,
        backgroundColor:
          dataset.color || defaultColors[index % defaultColors.length],
        borderWidth: 0,
        borderRadius: 2,
        // Reserve headroom so peak whiskers are not clipped at the top.
        categoryPercentage: 0.7,
        barPercentage: 0.85,
      }))

      const chart = new Chart(chartCanvas.value, {
        type: 'bar',
        data: { labels: props.labels, datasets },
        plugins: [errorBarPlugin],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 8 } },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: getComputedStyleValue('--vp-c-text-2'),
                padding: 14,
              },
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const d = props.data[context.datasetIndex]
                  const peak = d?.peak?.[context.dataIndex]
                  const s = props.yAxisSuffix
                  const base = `${context.dataset.label}: ${context.raw}${s} (p50)`
                  return peak != null ? `${base}, ${peak}${s} peak` : base
                },
              },
            },
          },
          scales: {
            x: {
              title: { display: !!props.xAxisTitle, text: props.xAxisTitle },
              grid: { drawOnChartArea: false },
            },
            y: {
              type: props.yScaleType,
              min: props.yScaleType === 'logarithmic' ? undefined : 0,
              title: { display: !!props.yAxisTitle, text: props.yAxisTitle },
              ticks: {
                maxTicksLimit: 5,
                callback: (v) => `${v}${props.yAxisSuffix}`,
              },
              // On a log axis, keep to a few round gridlines.
              afterBuildTicks:
                props.yScaleType === 'logarithmic'
                  ? (scale) => {
                      scale.ticks = [10, 100, 1000, 10000]
                        .filter((t) => t >= scale.min && t <= scale.max)
                        .map((value) => ({ value }))
                    }
                  : undefined,
              grid: { color: getComputedStyleValue('--vp-c-divider') },
            },
          },
        },
      })

      chartInstance.value = markRaw(chart)
    }

    onMounted(createChart)
    onUnmounted(() => {
      if (chartInstance.value) chartInstance.value.destroy()
    })
    watch([() => props.data, () => props.labels], createChart, { deep: true })

    return { chartCanvas, wrapperStyle }
  },
}
</script>

<template>
  <div class="MemoryErrorBarChart" :style="wrapperStyle">
    <h3>{{ title }}</h3>
    <canvas ref="chartCanvas"></canvas>
  </div>
</template>

<style scoped>
.MemoryErrorBarChart {
  width: 100%;
  position: relative;
  display: block;
  box-sizing: border-box;
}
.MemoryErrorBarChart h3 {
  text-align: center;
  margin-bottom: 0.5rem;
  color: var(--vp-c-text-1);
  font-size: 1.05rem;
  font-weight: 600;
}
</style>
