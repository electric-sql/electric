// @ts-expect-error ignore unused React
import React, { useEffect, useState } from 'react'
import Slider from 'react-rangeslider'

type Props = {
  value: number
  onChange: (value: number) => void
  onChangeComplete: (value: number) => void
}

// This is a range slider that properly supports change
// event handling:
//
// - `onChange` fires when dragging or clicking
// - `onChangeComplete` fires when finishing a drag or clicking
//
// This fixes the bad behaviour in Chrome and Firefox
// which treats the `change` event like the `input` event
const SliderInput = ({
  value,
  onChange,
  onChangeComplete,
  ...props
}: Props) => {
  const [changedValue, setChangedValue] = useState(value)
  const [completeCounter, setCompleteCounter] = useState(0)

  useEffect(() => {
    if (completeCounter === 0) {
      return
    }

    onChangeComplete(changedValue)
  }, [completeCounter])

  const handleChange = (value: number) => {
    setChangedValue(value)
    onChange(value)
  }

  const handleChangeComplete = () => {
    setCompleteCounter((counter) => counter + 1)
  }

  return (
    <Slider
      value={value}
      onChange={handleChange}
      onChangeComplete={handleChangeComplete}
      {...props}
    />
  )
}

export default SliderInput
