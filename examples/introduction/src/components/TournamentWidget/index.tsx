import clsx from 'clsx'
import React from 'react'
import { useDrop } from 'react-dnd'

import { PlayerWidget } from '../../components'
import { Player, Tournament } from '../../electric'

import styles from './styles.module.css'

export type Props = {
  tournament: any,
  onDrop: (item: any) => void
}

const TournamentWidget = ({deleteTournament, dndDiscriminator, onDrop, tournament}: Props) => {
  const players =
    tournament.players
    ? [...tournament.players].sort((a, b) => (
        parseInt(a.updated_at) - parseInt(b.updated_at)
      ))
    : []
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
    <div ref={drop} className={clsx(styles.tournament, isActive ? styles.tournamentActive : '')}
        data-testid="tournament">
      <label className={clsx('text-small', styles.tournamentLabel)}>
        Tournament { tournament.name }
      </label>
      <a onMouseDown={deleteTournament}
          className={clsx('text-small', styles.tournamentClose)}>
        <svg viewBox="0 0 24 24"
            stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
              d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </a>
      <div className={styles.playerListings}>
        {players.map((player: Player) => (
          <PlayerWidget key={player.id} player={player} dndDiscriminator={dndDiscriminator} />
        ))}
      </div>
    </div>
  )
}

export default TournamentWidget
