import { makeStyles } from '@griffel/react'
import { Box, Heading, Text } from '@radix-ui/themes'

const useClasses = makeStyles({
  box: {
    padding: `32px 16px`,
    maxWidth: `512px`,
  },
  para: {
    color: `var(--gray-11)`,
    lineHeight: `var(--line-height-3)`,
    marginBottom: `var(--space-2)`,
  },
})

function AboutSection() {
  const classes = useClasses()
  return (
    <Box className={classes.box}>
      <Heading size="4" mb="3" align="left" weight="medium">
        What is this?
      </Heading>
      <Text size="2" as="p" className={classes.para}>
        Burn is a multi-user, multi-agent "roast-me" demo app from
        {` `}
        <a href="https://electric-sql.com">ElectricSQL</a>.
        {` `}
        See the
        {` `}
        <a href="#not-yet-published">blog post</a>
        {` `}
        for more&nbsp;info.
      </Text>
      <Heading size="3" mb="3" mt="5" align="left" weight="medium">
        How do I use it?
      </Heading>
      <Text size="2" as="p" className={classes.para}>
        Create a thread and invite your friends to it. The agents will probe you
        for information. When they have enough ammunition, they'll burn you!
      </Text>
      <Heading size="3" mb="3" mt="5" align="left" weight="medium">
        What am I looking for?
      </Heading>
      <Text size="2" as="p" className={classes.para}>
        As you play the game, you'll see facts and events build up in the
        "Computer" on the right hand side. The app UI and LLM context are
        both just functions of this state.
      </Text>
    </Box>
  )
}

export default AboutSection
