import clsx from 'clsx'
import React, { useState } from 'react'

import { Item } from '../../electric'
import { timeResolution } from '../../util'

import ItemsWidget from '../ItemsWidget'
import styles from './styles.module.css'

type Props = {
  add: () => Promise<void>,
  clear: () => Promise<void>,
  items: Item[] | undefined,
  initialLatency: number,
  disableWhenInProgress: boolean,
  title: string,
  itemColor: string
}

const LatencyWidget = ({ add, clear, items, initialLatency, disableWhenInProgress, title, itemColor }: Props) => {
  const [ inProgress, setInProgress ] = useState(false)
  const [ elapsed, setElapsed ] = useState(initialLatency)

  const perform = async (action: () => Promise<void>) => {
    setInProgress(true)

    try {
      const promise = action()
      const { elapsed } = await timeResolution(promise)

      setElapsed(elapsed)
    }
    finally {
      setInProgress(false)
    }
  }

  let latencyColour
  if (elapsed < 50) {
    latencyColour = 'electric-green'
  }
  else if (elapsed < 100) {
    latencyColour = 'script-yellow'
  }
  else if (elapsed < 200) {
    latencyColour = 'script-orange'
  }
  else {
    latencyColour = 'script-red'
  }

  return (
    <div className={styles.widget}>
      <div className={styles.widgetHeading}>
        <h3>
          { title }
        </h3>
        <label className={clsx('section-label text-small', styles.latencyLabel, latencyColour)}>
          Latency: {elapsed}ms
        </label>
      </div>
      <ItemsWidget
          items={items}
          add={() => perform(add)}
          clear={() => perform(clear)}
          inProgress={inProgress}
          disableWhenInProgress={disableWhenInProgress}
          itemColor={itemColor}
      />
    </div>
  )
}

export default LatencyWidget
