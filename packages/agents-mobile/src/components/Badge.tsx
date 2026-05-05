import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTokens } from '../lib/ThemeProvider'
import { fontSize, radii, spacing } from '../lib/theme'
import type { Tokens } from '../lib/theme'

export type BadgeTone =
  | `neutral`
  | `info`
  | `success`
  | `warning`
  | `danger`
  | `accent`

/**
 * Tiny status pill — mirrors the web `<Badge variant="soft">`. 24px
 * tall to match the `IconButton size={1}` triggers it sits next to
 * in `EntityHeader`'s actions cluster.
 */
export function Badge({
  tone = `neutral`,
  children,
}: {
  tone?: BadgeTone
  children: string
}): React.ReactElement {
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens, tone), [tokens, tone])
  return (
    <View style={styles.root}>
      <Text style={styles.text}>{children}</Text>
    </View>
  )
}

function createStyles(tokens: Tokens, tone: BadgeTone) {
  const { bg, fg } = colorsFor(tokens, tone)
  return StyleSheet.create({
    root: {
      height: 24,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      backgroundColor: bg,
      alignItems: `center`,
      justifyContent: `center`,
    },
    text: {
      color: fg,
      fontSize: fontSize.xs,
      fontWeight: `500`,
      textTransform: `lowercase`,
    },
  })
}

function colorsFor(
  tokens: Tokens,
  tone: BadgeTone
): { bg: string; fg: string } {
  switch (tone) {
    case `info`:
      return { bg: tokens.blueA3, fg: tokens.blue11 }
    case `success`:
      return { bg: tokens.greenA3, fg: tokens.green11 }
    case `warning`:
      return { bg: tokens.amberA3, fg: tokens.amber11 }
    case `danger`:
      return { bg: tokens.redA2, fg: tokens.red11 }
    case `accent`:
      return { bg: tokens.accentA3, fg: tokens.accent11 }
    case `neutral`:
    default:
      return { bg: tokens.bgHover, fg: tokens.text2 }
  }
}
