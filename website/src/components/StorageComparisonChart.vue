<script>
import { ref, onMounted, markRaw, watch, computed, onUnmounted } from 'vue'
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
    title: {
      type: String,
      required: true,
    },
    subtitle: {
      type: String,
      default: '',
    },
    data: {
      type: Array,
      required: true,
      // Each item should have: { label: string, data: number[], color?: string, dashed?: boolean }
    },
    labels: {
      type: Array,
      required: true,
    },
    xAxisTitle: {
      type: String,
      default: 'X Axis',
    },
    yAxisTitle: {
      type: String,
      default: 'Y Axis',
    },
    yAxisSuffix: {
      type: String,
      default: '',
    },
    yScaleType: {
      type: String,
      default: 'linear',
      validator: (v) => ['linear', 'logarithmic'].includes(v),
    },
    // Optional secondary (right-hand) Y axis. Datasets opt in with yAxisID: 'y2'.
    y2AxisTitle: {
      type: String,
      default: '',
    },
    y2AxisSuffix: {
      type: String,
      default: '',
    },
    y2ScaleType: {
      type: String,
      default: 'linear',
      validator: (v) => ['linear', 'logarithmic'].includes(v),
    },
    // Fill legend/tooltip swatches with the line colour (solid) instead of
    // leaving them hollow/transparent.
    solidMarkers: {
      type: Boolean,
      default: false,
    },
    // Desired number of columns to render side-by-side responsively
    columns: {
      type: Number,
      default: 1,
    },
    // Fixed height for the chart container. Number -> px, or any CSS size string.
    height: {
      type: [Number, String],
      default: 320,
    },
  },
  setup(props) {
    Chart.defaults.color = getComputedStyleValue('--vp-c-text-1')
    Chart.defaults.borderColor = getComputedStyleValue('--vp-c-divider')
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

    // Reactive width handling
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

    const heightValue = computed(() => {
      if (typeof props.height === 'number') return `${props.height}px`
      return props.height
    })

    const wrapperStyle = computed(() => ({
      width: widthValue.value,
      height: heightValue.value,
    }))

    const createChart = () => {
      if (chartInstance.value) {
        chartInstance.value.destroy()
      }

      const defaultColors = [brandColor1, brandColor2, brandColor3, brandColor4]

      const datasets = props.data.map((dataset, index) => ({
        label: dataset.label,
        data: dataset.data,
        borderColor:
          dataset.color || defaultColors[index % defaultColors.length],
        // Translucent fill colour for range bands; with solidMarkers the
        // legend/tooltip swatch fills with the line colour; transparent otherwise.
        backgroundColor:
          dataset.fillColor ||
          (props.solidMarkers
            ? dataset.color || defaultColors[index % defaultColors.length]
            : 'transparent'),
        borderWidth: 2,
        // Force CubDB lines to be solid regardless of dashed flag
        borderDash:
          dataset.label && dataset.label.toLowerCase().includes('cubdb')
            ? undefined
            : dataset.dashed
              ? [5, 5]
              : undefined,
        pointStyle: false,
        // `fill` can target another dataset (e.g. '+1') to shade a band.
        fill: dataset.fill ?? false,
        // Datasets may render against the secondary axis via yAxisID: 'y2'.
        yAxisID: dataset.yAxisID || 'y',
        order: index + 1,
      }))

      const hasY2 = props.data.some((d) => d.yAxisID === 'y2')

      const chartData = {
        labels: props.labels,
        datasets,
      }

      const chart = new Chart(chartCanvas.value, {
        type: 'line',
        data: chartData,
        options: {
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: getComputedStyleValue('--vp-c-text-2'),
                usePointStyle: false,
                padding: 14,
              },
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                title: (context) => {
                  return `${props.xAxisTitle}: ${context[0].label}`
                },
                label: (context) => {
                  const suffix =
                    context.dataset.yAxisID === 'y2'
                      ? props.y2AxisSuffix
                      : props.yAxisSuffix
                  return `${context.dataset.label}: ${context.raw}${suffix}`
                },
              },
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          // Let CSS control height/width
          resizeDelay: 40,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          hover: {
            mode: 'index',
            intersect: false,
          },
          scales: {
            x: {
              title: {
                display: true,
                text: props.xAxisTitle,
              },
              grid: {
                drawOnChartArea: false,
              },
            },
            y: {
              type: props.yScaleType,
              position: 'left',
              min: props.yScaleType === 'logarithmic' ? undefined : 0,
              title: {
                display: true,
                text: props.yAxisTitle,
              },
              ticks: {
                callback: (value) => `${value}${props.yAxisSuffix}`,
              },
              grid: {
                color: getComputedStyleValue('--vp-c-divider'),
              },
            },
            ...(hasY2
              ? {
                  y2: {
                    type: props.y2ScaleType,
                    position: 'right',
                    min: props.y2ScaleType === 'logarithmic' ? undefined : 0,
                    title: {
                      display: true,
                      text: props.y2AxisTitle,
                    },
                    ticks: {
                      callback: (value) => `${value}${props.y2AxisSuffix}`,
                    },
                    // Keep the right axis gridlines off the chart area to
                    // avoid doubling the left axis grid.
                    grid: {
                      drawOnChartArea: false,
                    },
                  },
                }
              : {}),
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

    // Watch for prop changes and recreate chart
    watch(
      [() => props.data, () => props.labels],
      () => {
        createChart()
      },
      { deep: true }
    )

    return {
      chartCanvas,
      wrapperEl,
      wrapperStyle,
    }
  },
}
</script>

<template>
  <div class="StorageComparisonGraph" ref="wrapperEl" :style="wrapperStyle">
    <h3>{{ title }}</h3>
    <p v-if="subtitle" class="chart-subtitle">{{ subtitle }}</p>
    <canvas ref="chartCanvas"></canvas>
  </div>
</template>

<style scoped>
.StorageComparisonGraph {
  width: 100%;
  position: relative;
  display: block;
  box-sizing: border-box;
  margin-bottom: 1.75rem;
}

@media (max-width: 860px) {
  .StorageComparisonGraph {
    width: 100% !important;
  }
}

.StorageComparisonGraph h3 {
  text-align: center;
  margin-bottom: 0.25rem;
  color: var(--vp-c-text-1);
  font-size: 1.05rem;
  font-weight: 600;
}

.StorageComparisonGraph .chart-subtitle {
  text-align: center;
  margin: 0 0 0.5rem;
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
}
</style>
