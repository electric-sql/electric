import clsx from 'clsx'
import React from 'react'
import { useDrag } from 'react-dnd'
import { Player } from '../../electric'
import styles from './styles.module.css'

type Props = {
  player: Player
}

const PlayerWidget = ({ dndDiscriminator, player }: Props) => {
  const [{isDragging}, drag] = useDrag(
    () => ({
      type: `PLAYER-${dndDiscriminator}`,
      item: player,
      collect: monitor => ({
        isDragging: !!monitor.isDragging(),
      }),
    }),
    [player]
  )

  return (
    <div className={clsx(styles.player, styles[player.color])}
        ref={drag}
    />
  )
}

export default PlayerWidget
