import clsx from 'clsx'
import React, { useEffect, useState } from 'react'

import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { TouchBackend } from 'react-dnd-touch-backend'

import { useLiveQuery } from 'electric-sql/react'
import { QualifiedTablename, uuid } from 'electric-sql/util'

import { App, ConnectivityControl, PlayersWidget, TournamentWidget } from '../../components'
import { useElectric } from '../../electric'
import { boostrapPlayers, boostrapTournament, useDemoContext } from '../../session'

const tournamentsChange = {
  qualifiedTablename: new QualifiedTablename('main', 'tournaments')
}

const newTournament = (name, demo) => {
  const ts = `${Date.now()}`

  return {
    id: uuid(),
    name: name,
    demo_id: demo.id,
    demo_name: demo.name,
    inserted_at: ts,
    updated_at: ts,
    electric_user_id: demo.electric_user_id
  }
}

const Integrity = ({ scopedTournmentCounter, userId, userColor }) => {
  const { db, notifier } = useElectric()
  const { demo } = useDemoContext()
  const [ scopedCounter, setScopedCounter ] = useState(scopedTournmentCounter)

  const { results: tournaments } = useLiveQuery(
    db.tournaments.liveMany({
      where: {
        demo_name: demo.name,
        electric_user_id: demo.electric_user_id
      },
      include: {
        players: true
      },
      orderBy: {
        inserted_at: 'asc'
      },
      take: 24
    })
  )

  const { results: unEnrolledPlayers } = useLiveQuery(
    db.players.liveMany({
      where: {
        demo_name: demo.name,
        electric_user_id: demo.electric_user_id,
        tournament_id: null
      },
      orderBy: {
        updated_at: 'asc'
      },
      take: 24
    })
  )

  const addTournament = async () => {
    const counter = scopedCounter + 1
    const name = `${userId}:${counter}`

    setScopedCounter(counter)

    await db.tournaments.create({
      data: newTournament(name, demo)
    })
  }

  const deleteTournament = async (tournament) => {
    await db.tournaments.delete({
      where: {
        id: tournament.id
      }
    })
  }

  const enroll = async (player, tournament) => {
    const ts = `${Date.now()}`

    await db.players.update({
      data: {
        tournament_id: tournament.id,
        updated_at: ts
      },
      where: {
        id: player.id
      }
    })
  }

  const unenroll = async (player) => {
    const ts = `${Date.now()}`

    const tournament_id = player.tournament_id
    if (tournament_id === null) {
      return
    }

    await db.players.update({
      data: {
        tournament_id: null,
        updated_at: ts
      },
      where: {
        id: player.id
      }
    })
  }

  if (tournaments === undefined || unEnrolledPlayers === undefined) {
    return null
  }

  return (
    <div className="mb-4">
      <div className="flex flex-row items-center justify-between pb-3 mb-5"
          style={{borderBottom: '1px solid var(--card-border)'}}>
        <label className={clsx('section-label text-small', userColor)}>
          User: {userId}
        </label>
        <ConnectivityControl />
      </div>
      <div className="flex flex-row my-4">
        <div className="basis-1/2">
          <PlayersWidget
              players={unEnrolledPlayers}
              dndDiscriminator={userId}
              onDrop={(player) => unenroll(player)}
          />
        </div>
        <div className="basis-1/2">
          <div className="relative block">
            {tournaments.map((tournament, index) => (
              <TournamentWidget
                  key={ tournament.id }
                  tournament={tournament}
                  dndDiscriminator={userId}
                  onDrop={(player) => enroll(player, tournament)}
                  deleteTournament={() => deleteTournament(tournament)}
              />
            ))}
            <div>
              <button className="button button--secondary button--outline button--sm me-2"
                  onMouseDown={addTournament}>
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const Wrapper = ({bootstrappedPlayerColors, userColor, userId}) => {
  const { db } = useElectric()
  const { demo } = useDemoContext()
  const [ scopedCounter, setScopedCounter ] = useState(undefined)
  const [ ready, setReady ] = useState(false)

  useEffect(() => {
    let isMounted = true

    const bootstrap = async () => {
      const players = await boostrapPlayers(db, demo, bootstrappedPlayerColors)
      const numTournments = await boostrapTournament(db, demo, `${userId}:1`)

      if (!isMounted) {
        return
      }

      setScopedCounter(numTournments)
      setReady(true)
    }

    bootstrap()

    return () => {
      isMounted = false
    }
  }, [])

  if (!ready) {
    return null
  }

  const backend =
    window.matchMedia('(pointer: coarse)').matches
    ? TouchBackend
    : HTML5Backend

  return (
    <DndProvider backend={backend}>
      <Integrity
          scopedTournmentCounter={scopedCounter}
          userColor={userColor}
          userId={userId}
      />
    </DndProvider>
  )
}

const Demo = () => (
  <div className="grid grid-cols-1 sm:grid-cols-2 integrity-grid-cols gap-6">
    <div className="px-3 md:px-4">
      <App dbName="user1" demoName="integrity">
        <Wrapper
            userId={1}
            userColor="electric-green"
            bootstrappedPlayerColors={['green', 'yellow']}
        />
      </App>
    </div>
    <div className="px-3 md:px-4">
      <App dbName="user2" demoName="integrity">
        <Wrapper
            userId={2}
            userColor="script-purple"
            bootstrappedPlayerColors={['red', 'purple']}
        />
      </App>
    </div>
  </div>
)

export default Demo
