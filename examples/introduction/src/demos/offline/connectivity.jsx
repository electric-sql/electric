import clsx from 'clsx'
import React, { useEffect, useState } from 'react'

import { useLiveQuery } from 'electric-sql/react'
import { genUUID } from 'electric-sql/util'

import { App, ConnectivityControl, ItemsWidget, SliderInput } from '../../components'
import { useElectric } from '../../electric'
import { boostrapSlider, useDemoContext } from '../../session'

const newItem = (demo) => {
  return {
    id: genUUID(),
    inserted_at: `${Date.now()}`,
    demo_id: demo.id,
    demo_name: demo.name,
    electric_user_id: demo.electric_user_id
  }
}

const RealtimeWithConnectivity = ({ itemColor, slider, userId }) => {
  const { db } = useElectric()
  const { demo } = useDemoContext()
  const [ sliderValue, setSliderValue ] = useState(slider.value)

  const { results: liveItems } = useLiveQuery(
    db.items.liveMany({
      where: {
        demo_name: demo.name,
        electric_user_id: demo.electric_user_id
      },
      orderBy: {
        inserted_at: 'asc'
      },
      take: 24
    })
  )

  const { results: liveSlider } = useLiveQuery(
    db.sliders.liveFirst({
      where: {
        demo_name: demo.name,
        electric_user_id: demo.electric_user_id
      },
      select: {
        id: true,
        value: true
      },
      orderBy: {
        id: 'asc'
      }
    })
  )

  useEffect(() => {
    if (liveSlider === undefined) {
      return
    }

    setSliderValue(liveSlider.value)
  }, [liveSlider])

  const add = async () => {
    await db.items.create({
      data: newItem(demo)
    })
  }

  const clear = async () => {
    await db.items.deleteMany({
      where: {
        demo_name: demo.name,
        electric_user_id: demo.electric_user_id
      }
    })
  }

  const syncSlider = async (value) => {
    await db.sliders.updateMany({
      where: {
        demo_name: demo.name,
        electric_user_id: demo.electric_user_id
      },
      data: {
        value: value
      }
    })
  }

  if (liveItems === undefined) {
    return null
  }

  return (
    <div className="mb-4">
      <div className="flex flex-row items-center justify-between pb-3 mb-5"
          style={{borderBottom: '1px solid var(--card-border)'}}>
        <label className={clsx('section-label text-small', itemColor)}>
          User: {userId}
        </label>
        <ConnectivityControl />
      </div>
      <div className={clsx('my-8', itemColor)}>
        <SliderInput
            min={0}
            max={100}
            step={1}
            value={sliderValue}
            onChange={setSliderValue}
            onChangeComplete={syncSlider}
        />
      </div>
      <ItemsWidget
          add={add}
          clear={clear}
          items={liveItems}
          itemColor={itemColor}
          disableWhenInProgress={false}
      />
    </div>
  )
}

// Setup the slider in a Wrapper rather than directly
// in the Demo below so we can use the db and
// demoContext setup by the App component.
const Wrapper = ({itemColor, userId}) => {
  const { db } = useElectric()
  const { demo } = useDemoContext()
  const [ slider, setSlider ] = useState()

  useEffect(() => {
    let isMounted = true

    const ensureSlider = async () => {
      const slider = await boostrapSlider(db, demo)

      if (!isMounted) {
        return
      }

      setSlider(slider)
    }

    ensureSlider()

    return () => {
      isMounted = false
    }
  }, [])

  if (slider === undefined) {
    return null
  }

  return (
    <RealtimeWithConnectivity
        slider={slider}
        userId={userId}
        itemColor={itemColor}
    />
  )
}

const Demo = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
    <div className="px-3 md:px-4">
      <App dbName="user1" demoName="offline-connectivity" bootstrapItems={2}>
        <Wrapper userId={1} itemColor="electric-green" />
      </App>
    </div>
    <div className="px-3 md:px-4">
      <App dbName="user2" demoName="offline-connectivity" bootstrapItems={2}>
        <Wrapper userId={2} itemColor="script-purple" />
      </App>
    </div>
  </div>
)

export default Demo
