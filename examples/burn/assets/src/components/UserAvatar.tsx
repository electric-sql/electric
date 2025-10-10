import { memo } from 'react'
import { Tooltip } from '@radix-ui/themes'
import { makeStyles, mergeClasses } from '@griffel/react'

type UserAvatarProps = {
  username: string
  size?: `small` | `medium` | `large`
  showTooltip?: boolean
  index?: number // For staggered positioning
  imageUrl?: string // Optional image URL
}

// Simple hash function to generate a consistent color from username
function stringToColor(str: string) {
  if (!str) {
    return 'hsl(280, 60%, 55%)'
  }

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

const useClasses = makeStyles({
  avatar: {
    color: `white`,
    borderRadius: `50%`,
    display: `flex`,
    alignItems: `center`,
    justifyContent: `center`,
    fontWeight: `bold`,
    textTransform: `uppercase`,
    letterSpacing: `0.5px`,
    position: `relative`,
    boxSizing: `border-box`,
    fontSize: `var(--font-size-2)`,
    overflow: 'hidden'
  },
  image: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  small: {
    width: `20px`,
    height: `20px`,
    fontSize: `8px`,
  },
  medium: {
    width: `30px`,
    height: `30px`,
    fontSize: `12px`,
  },
  large: {
    width: `40px`,
    height: `40px`,
    fontSize: `14px`,
  },
  'small.overlap': {
    marginLeft: `-${Math.floor(parseInt(`10px`) * 0.35)}px`,
  },
  'medium.overlap': {
    marginLeft: `-${Math.floor(parseInt(`20px`) * 0.25)}px`,
  },
  'large.overlap': {
    marginLeft: `-${Math.floor(parseInt(`30px`) * 0.35)}px`,
  },
})

const UserAvatar = memo(
  ({
    username,
    size = `medium`,
    showTooltip = true,
    index = 0,
    imageUrl,
  }: UserAvatarProps) => {
    const classes = useClasses()
    const backgroundColor = stringToColor(username)
    const initials = getInitials(username)

    const avatar = (
      <div
        className={mergeClasses(
          classes.avatar,
          classes[size],
          index > 0 && classes[`${size}.overlap`]
        )}
        style={{
          backgroundColor: imageUrl ? 'transparent' : backgroundColor,
        }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={username} className={classes.image} />
        ) : (
          initials
        )}
      </div>
    )

    if (showTooltip) {
      return <Tooltip content={username}>{avatar}</Tooltip>
    }

    return avatar
  }
)

export default UserAvatar
