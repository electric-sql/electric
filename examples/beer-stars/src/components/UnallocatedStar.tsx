import React from 'react'
import { Beer, Star, useElectric } from '../electric'

type Props = {
  star: Star,
  beers: Beer[]
}

const UnallocatedStar = ({ star, beers }: Props) => {
  const { db } = useElectric()!

  const allocateBeer = () => {
    if (beers.length < 1) {
      return
    }

    const beer = beers[0]

    db.beers.update({
      data: {
        star_id: star.id
      },
      where: {
        id: beer.id
      }
    })
  }

  return (
    <div className="unallocated-star">
      <a className={beers.length < 1 ? 'hidden add-btn' : 'add-btn'} onClick={allocateBeer}>
        +
      </a>
      <img src={star.avatar_url} className="avatar" />
      <div className="names">
        {star.name !== null && <div className="name">{ star.name }</div>}
        <div className="username">
          @{ star.username }
        </div>
      </div>


    </div>
  )
}

export default UnallocatedStar
