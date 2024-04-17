import clsx from 'clsx'
import { useDrop } from 'react-dnd'
import { Item, Player } from '../../electric'
import PlayerWidget from '../PlayerWidget'
import styles from './styles.module.css'

type Props = {
  players: Player[]
  onDrop: (item: Item) => void
  dndDiscriminator: string
}

const PlayersWidget = ({ dndDiscriminator, onDrop, players }: Props) => {
  const playerIds = players.map((x) => x.id)

  const [{ canDrop, isOver }, drop] = useDrop({
    accept: `PLAYER-${dndDiscriminator}`,
    drop: onDrop,
    canDrop: (item) => !playerIds.includes(item.id),
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  })

  const isActive = isOver && canDrop

  return (
    <div
      ref={drop}
      className={clsx(styles.players, isActive ? styles.playersActive : '')}
      data-testid="players"
    >
      <div className={clsx('text-small', styles.playersLabel)}>Players</div>
      <div className={styles.playerListings}>
        {players.map((player) => (
          <PlayerWidget
            key={player.id}
            player={player}
            dndDiscriminator={dndDiscriminator}
          />
        ))}
      </div>
    </div>
  )
}

export default PlayersWidget
