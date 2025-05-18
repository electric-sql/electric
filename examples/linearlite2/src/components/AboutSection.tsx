import { Box, Heading, Text } from '@radix-ui/themes'

export default function AboutSection() {
  return (
    <Box style={{ padding: `32px 16px`, maxWidth: `600px` }}>
      <Heading size="3" mb="2" align="center" weight="medium">
        About Linearlite
      </Heading>
      <Text size="2" color="gray">
        TODO: Write an about section
      </Text>
      <Heading size="3" mb="2" mt="4" align="center" weight="medium">
        ElectricSQL
      </Heading>
      <Text size="2" color="gray">
        Electric is a Postgres sync engine. It solves the hard problems of sync
        for you, including partial replication, fan-out, and data delivery. See
        {` `}
        <a href="https://electric-sql.com">electric-sql.com</a> for more
        information.
      </Text>
    </Box>
  )
}
