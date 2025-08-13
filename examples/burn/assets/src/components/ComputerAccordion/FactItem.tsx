import { Box, Badge, Text, Tooltip } from '@radix-ui/themes'
import { makeStyles, mergeClasses } from '@griffel/react'
import { Lightbulb } from 'lucide-react'
import type { FactResult } from '../../types'

type ConfidenceConfig = {
  color: string
  fill: string
  level: string
}

function confidenceConfig(confidence: number): ConfidenceConfig {
  if (confidence >= 0.8) {
    return {
      level: 'High confidence',
      color: 'var(--green-9)',
      fill: 'var(--green-9)',
    }
  }

  if (confidence >= 0.5) {
    return {
      level: 'Medium confidence',
      color: 'var(--orange-9)',
      fill: 'var(--orange-9)',
    }
  }

  return {
    level: 'Low confidence',
    color: 'var(--red-9)',
    fill: '',
  }
}

const useStyles = makeStyles({
  factItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    lineHeight: '1.4',
    paddingTop: 'var(--space-1)',
    paddingBottom: 'var(--space-1)',
    minWidth: 0,
  },
  icon: {
    flexShrink: 0,
    flexGrow: 0,
  },
  badge: {
    whiteSpace: 'normal',
    wordBreak: 'break-word',
    minWidth: 0,
  },
  subject: {
    flex: '0 0 auto',
    minWidth: 0,
  },
  predicate: {
    color: 'var(--gray-12)',
    flex: '0 1 auto'
  },
  object: {
    flex: '0 2 auto',
    minWidth: 0,
  },
})

type Props = {
  fact: FactResult
}

function FactItem({ fact }: Props) {
  const classes = useStyles()
  const { color, fill, level } = confidenceConfig(fact.confidence)
  const tooltipContent = `${level} (${fact.confidence})`

  const subjectClassName = mergeClasses(classes.badge, classes.subject)
  const predicateClassName = mergeClasses(classes.badge, classes.predicate)
  const objectClassName = mergeClasses(classes.badge, classes.object)

  // const objectText =
  //   fact.object.length > 22
  //   ? fact.object.slice(0, 20).replace(/\s+\S*$/, '') + ' ...'
  //   : fact.object

  return (
    <Box className={classes.factItem}>
      <Tooltip content={tooltipContent}>
        <Lightbulb
          size={12}
          color={color}
          fill={fill}
          className={classes.icon}
        />
      </Tooltip>
      <Badge size="1" variant="soft" color="blue" className={subjectClassName}>
        {fact.subject}
      </Badge>
      <Text size="1" weight="medium" className={predicateClassName}>
        {fact.predicate}
      </Text>
      <Badge size="1" variant="soft" color="orange" className={objectClassName}>
        {fact.object}
      </Badge>
    </Box>
  )
}

export default FactItem
