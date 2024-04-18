import clsx from 'clsx'
// @ts-expect-error ignore unused React
import React from 'react'
import { useDrag } from 'react-dnd'
import { Player } from '../../electric'
import styles from './styles.module.css'

type Props = {
  player: Player
  dndDiscriminator: string
}

const PlayerWidget = ({ dndDiscriminator, player }: Props) => {
  const [, drag] = useDrag(
    () => ({
      type: `PLAYER-${dndDiscriminator}`,
      item: player,
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
    }),
    [player],
  )

  return (
    <div className={clsx(styles.player, styles[player.color])} ref={drag} />
  )
}

export default PlayerWidget
