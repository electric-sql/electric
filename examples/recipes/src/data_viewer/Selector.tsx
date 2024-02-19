import { FormControl, InputLabel, MenuItem, Select, SxProps } from '@mui/material'

export const Selector = ({
  label,
  selectedValue,
  values,
  valueLabels,
  onValueSelected,
  style,
}: {
  label: string
  selectedValue: string
  values: string[]
  valueLabels?: string[]
  onValueSelected: (newValue: string) => void
  style?: SxProps
}) => {
  return (
    <FormControl color="secondary" sx={style}>
      <InputLabel>{label}</InputLabel>
      <Select value={selectedValue} label={label} onChange={(e) => onValueSelected(e.target.value)}>
        {values.map((val, idx) => (
          <MenuItem key={idx} value={val}>
            {valueLabels?.[idx] ?? val}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
