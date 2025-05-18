import { memo } from 'react'
import { Tooltip } from '@radix-ui/themes'

interface UserAvatarProps {
  username: string
  size?: `small` | `medium` | `large`
  showTooltip?: boolean
  index?: number // For staggered positioning
}

// Simple hash function to generate a consistent color from username
function stringToColor(str: string) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }

  // Modern flat UI colors - pre-defined palette for better consistency
  const colors = [
    `hsl(210, 70%, 55%)`, // Blue
    `hsl(170, 70%, 45%)`, // Teal
    `hsl(150, 65%, 50%)`, // Green
    `hsl(280, 60%, 55%)`, // Purple
    `hsl(350, 70%, 55%)`, // Pink
    `hsl(30, 80%, 55%)`, // Orange
    `hsl(190, 60%, 50%)`, // Cyan
    `hsl(0, 70%, 55%)`, // Red
  ]

  // Select a color from our palette based on the hash
  return colors[Math.abs(hash) % colors.length]
}

// Get first two letters of username, handling edge cases
function getInitials(username: string) {
  if (!username || typeof username !== `string`) return `??`

  // If username contains a space, use first letters of first two words
  if (username.includes(` `)) {
    const parts = username.split(` `).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
  }

  // Otherwise use first two letters
  return username.slice(0, 2).toUpperCase()
}

const UserAvatar = memo(
  ({
    username,
    size = `medium`,
    showTooltip = true,
    index = 0,
  }: UserAvatarProps) => {
    const backgroundColor = stringToColor(username)
    const initials = getInitials(username)

    // Size mappings
    const sizeMap = {
      small: { size: `20px`, fontSize: `8px` },
      medium: { size: `28px`, fontSize: `11px` },
      large: { size: `40px`, fontSize: `14px` },
    }

    const { size: dimensions, fontSize } = sizeMap[size]
    const overlapOffset =
      index > 0 ? `-${Math.floor(parseInt(dimensions) * 0.35)}px` : `0`

    const avatar = (
      <div
        style={{
          backgroundColor,
          color: `white`,
          width: dimensions,
          height: dimensions,
          borderRadius: `50%`,
          display: `flex`,
          alignItems: `center`,
          justifyContent: `center`,
          fontSize,
          fontWeight: `600`,
          marginLeft: overlapOffset,
          zIndex: 10 - index, // Higher index = lower z-index for proper stacking
          textTransform: `uppercase`,
          letterSpacing: `0.5px`,
          position: `relative`,
          boxSizing: `border-box`,
          outline: index > 0 ? `1px solid rgba(255, 255, 255, 0.15)` : `none`,
        }}
      >
        {initials}
      </div>
    )

    if (showTooltip) {
      return <Tooltip content={username}>{avatar}</Tooltip>
    }

    return avatar
  }
)

export default UserAvatar
