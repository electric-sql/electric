import { TextField } from '@radix-ui/themes'
import { makeStyles } from '@griffel/react'

const useStyles = makeStyles({
  filterInput: {
    marginBottom: 'var(--space-1)',
    boxShadow: 'inset 0 0 0 var(--text-field-border-width) var(--gray-a4)',
    '&:focus-within': {
      boxShadow: 'inset 0 0 0 0.5px rgb(146, 129, 255) !important',
      outline: 'none !important',
    },
    '& input': {
      fontSize: '11px',
      backgroundColor: 'transparent',
      border: 'none',
      boxShadow: 'none',
      outline: 'none',
      '&:focus': {
        outline: 'none',
        boxShadow: 'none',
      },
      '&:focus-visible': {
        outline: 'none',
        boxShadow: 'none',
      },
      '&::placeholder': {
        color: 'var(--gray-8)',
        fontSize: '11px',
      },
    },
  },
})

interface Props {
  value?: string
  placeholder?: string
  onChange: (value: string) => void
}

function FilterInput({
  value = '',
  placeholder = 'Filter ...',
  onChange,
}: Props) {
  const classes = useStyles()

  return (
    <TextField.Root
      size="1"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={classes.filterInput}
    />
  )
}

export default FilterInput
