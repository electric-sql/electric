import React from 'react'
import { useLiveQuery } from 'electric-sql/react'
import { Beer, Star, useElectric } from '../electric'
import { splitStars } from '../util'

import BeersWidget from './BeersWidget'
import StarListing from './StarListing'

const MainPage = () => {
  const { db } = useElectric()!

  const { results: beers } = useLiveQuery(db.beers.liveMany({}))
  const { results: stars } = useLiveQuery(db.stars.liveMany({
    orderBy: {
      starred_at: 'desc'
    },
    take: 50
  }))

  if (beers === undefined || stars === undefined) {
    return null
  }

  const { starsWithBeers, starsWithoutBeers } = splitStars(beers, stars)

  return (
    <div>
      <BeersWidget />
      <StarListing label="New!" stars={starsWithoutBeers} allocated={false} />
      <StarListing label="Allocated" stars={starsWithBeers} allocated={true} />
    </div>
  )
}

export default MainPage
