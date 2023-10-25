import { useEffect, useState, useMemo, useCallback, useRef } from 'react'

import { makeElectricContext, useLiveQuery } from 'electric-sql/react'
import { genUUID, uniqueTabId } from 'electric-sql/util'
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'

import { authToken } from './auth'
import { DEBUG_MODE, ELECTRIC_URL } from './config'
import { Electric, Pixels, schema } from './generated/client'

import './ElectricPixels.css'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

interface PixelMap {
  [coord: string]: string
}

export const ElectricPixelsApp = () => {
  const [electric, setElectric] = useState<Electric>()
  const [defaultPixels, setDefaultPixels] = useState<PixelMap>()

  useEffect(() => {
    let isMounted = true

    const init = async () => {
      const config = {
        auth: {
          token: authToken(),
        },
        debug: DEBUG_MODE,
        url: ELECTRIC_URL,
      }

      const { tabId } = uniqueTabId()
      const tabScopedDbName = `electric-${tabId}.db`

      const conn = await ElectricDatabase.init(tabScopedDbName, '')
      const electric = await electrify(conn, schema, config)

      if (!isMounted) {
        return
      }

      setElectric(electric)
    }

    init()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      const pixels = await getDefaultPixels()
      setDefaultPixels(pixels)
    }
    init()
  }, [])

  if (electric === undefined || defaultPixels === undefined) {
    return null
  }

  return (
    <ElectricProvider db={electric}>
      <ElectricPixels defaultPixels={defaultPixels} />
    </ElectricProvider>
  )
}

export const ElectricPixels = ({
  defaultPixels,
}: {
  defaultPixels: PixelMap
}) => {
  const { db, satellite } = useElectric()!
  const [selectedColor, setSelectedColor] = useState<string>('#ff0000')
  const canvasEl = useRef<HTMLDivElement>(null)
  const clientId = (satellite as any)._authState.clientId

  const { results } = useLiveQuery(db.pixels.liveMany())
  const [mouseDown, setMouseDown] = useState(false)

  const width = 32
  const height = 32

  useEffect(() => {
    const syncItems = async () => {
      // Resolves when the shape subscription has been established.
      const pixelsShape = await db.pixels.sync()

      // Resolves when the data has been synced into the local database.
      await pixelsShape.synced
    }

    syncItems()
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      // Position is relative to the canvas element, not the window.
      const { left, top, width, height } =
        canvasEl.current!.getBoundingClientRect()
      const x = (e.clientX - left) / width
      const y = (e.clientY - top) / height
    }
    document.addEventListener('mousemove', onMouseMove)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
    }
  }, [])

  const pixels = useMemo(() => {
    const pixels: PixelMap = { ...defaultPixels }

    results?.forEach((pixel) => {
      pixels[pixel.coords] = pixel.color
    })

    return pixels
  }, [results])

  const drawPixel = useCallback(
    async (x: number, y: number) => {
      await db.pixels.upsert({
        create: {
          coords: `${x},${y}`,
          color: selectedColor,
        },
        update: {
          color: selectedColor,
        },
        where: {
          coords: `${x},${y}`,
        },
      })
    },
    [selectedColor]
  )

  const reset = useCallback(async () => {
    await db.pixels.deleteMany({})
  }, [])

  return (
    <div className="electric-pixels">
      <div>
        <div className="electric-pixels__color-picker">
          {colorOptions.map((color) => (
            <div
              key={color}
              className="electric-pixels__color-picker__color"
              style={{
                backgroundColor: color,
                outline: color === selectedColor ? '2px solid black' : 'none',
                outlineOffset: '-2px',
                zIndex: color === selectedColor ? 1 : 0,
              }}
              onClick={() => setSelectedColor(color)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={reset}
          className="electric-pixels__reset-button"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path
              fillRule="evenodd"
              d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"
            />
            <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z" />
          </svg>
        </button>
      </div>
      <div className="electric-pixels__grid-wrapper">
        <div
          ref={canvasEl}
          className="electric-pixels__grid"
          style={{
            gridTemplateColumns: `repeat(${width}, 1fr)`,
            gridTemplateRows: `repeat(${height}, 1fr)`,
          }}
          onMouseDown={() => setMouseDown(true)}
          onMouseUp={() => setMouseDown(false)}
        >
          {Array.from({ length: width * height }).map((_, i) => {
            const x = i % width
            const y = Math.floor(i / width)
            return (
              <Pixel
                key={`${x},${y}`}
                x={x}
                y={y}
                color={pixels[`${x},${y}`]}
                mouseIsDown={mouseDown}
                drawPixel={drawPixel}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

const Pixel = ({
  x,
  y,
  color,
  mouseIsDown,
  drawPixel,
}: {
  x: number
  y: number
  color: string
  mouseIsDown: boolean
  drawPixel: (x: number, y: number) => Promise<void>
}) => {
  return (
    <div
      className="electric-pixels__pixel"
      onMouseOver={() => {
        if (mouseIsDown) {
          drawPixel(x, y)
        }
      }}
      onMouseDown={() => drawPixel(x, y)}
      style={{
        backgroundColor: color,
      }}
    />
  )
}

const colorOptions = [
  '#141518', // Off black to match the background of the icon
  '#808080',
  '#c0c0c0',
  '#ffffff',
  '#800000',
  '#ff0000',
  '#808000',
  '#ffff00',
  '#008000',
  '#00ff00',
  '#008080',
  '#00ffff',
  '#000080',
  '#0000ff',
  '#800080',
  '#ff00ff',
  '#0DA17C', // Electric green dark
  '#02D3A1', // Electric green
]

const getDefaultPixels = async (): Promise<PixelMap> => {
  return new Promise((resolve) => {
    const pngUrl = './icon.png'
    const pixels: PixelMap = {}
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    img.src = pngUrl
    img.onload = () => {
      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, img.width, img.height).data
      for (let i = 0; i < data.length; i += 4) {
        const x = Math.floor((i / 4) % img.width)
        const y = Math.floor(i / 4 / img.width)
        const color = `rgba(${data[i]}, ${data[i + 1]}, ${data[i + 2]}, ${
          data[i + 3] / 255
        })`
        pixels[`${x},${y}`] = color
      }
      resolve(pixels)
    }
  })
}

function throttle<F extends Function>(fn: F, ms: number) {
  let lastCalled = 0
  return (...args: any) => {
    const now = Date.now()
    if (now - lastCalled > ms) {
      fn(...args)
      lastCalled = now
    }
  }
}
