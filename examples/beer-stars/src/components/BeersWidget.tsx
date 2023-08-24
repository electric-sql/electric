import React from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useLiveQuery } from 'electric-sql/react'
import { Beer, Star, useElectric } from '../electric'

const newBeer = () => {
  return {
    id: uuidv4()
  }
}

const BeersWidget = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(db.beers.liveMany({
    where: {
      star_id: null
    }
  }))

  const add = async () => {
    await db.beers.create({data: newBeer()})
  }

  const clear = async () => {
    await db.beers.deleteMany({
      where: {
        star_id: null
      }
    })
  }

  const availableBeers = results !== undefined ? [...results] : []

  return (
    <div className="beers-widget">
      <div className="block-buttons">
        <a onClick={add} className="btn">
          Pour
        </a>
        <a onClick={clear} className="btn">
          Empty
        </a>
      </div>
      <ul className="available-beers">
        {/*<li key={-1}>
          <div className="beer-label">
            { availableBeers.length }
            &nbsp;
            beer
            <span className={availableBeers.length === 1 ? 'hidden' : ''}>
              s
            </span>
          </div>
        </li>*/}
        {availableBeers.map((beer: Beer, index: number) => (
          <li key={ index }>
            <div className="beer" style={{zIndex: 100_00 - index}}>
              🍺
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default BeersWidget
