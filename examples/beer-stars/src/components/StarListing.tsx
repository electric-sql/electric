import React from 'react'
import { useLiveQuery } from 'electric-sql/react'
import { Beer, Star, useElectric } from '../electric'

import AllocatedStar from './AllocatedStar'
import UnallocatedStar from './UnallocatedStar'

type Props = {
  allocated: boolean,
  label: string,
  stars: Star[]
}

const StarListing = ({ allocated, label, stars }: Props) => {
  const { db } = useElectric()!
  const { results: beers } = useLiveQuery(db.beers.liveMany({
    where: {
      star_id: null
    }
  }))

  if (beers === undefined) {
    return null
  }

  return (
    <ul className="star-listing">
      {stars.map((star: Star, index: number) => (
        <li key={ index }>
          {allocated
            ? <AllocatedStar star={star} />
            : <UnallocatedStar star={star} beers={beers} />
          }
        </li>
      ))}
    </ul>
  )
}

export default StarListing
