import React from 'react'
import { Star } from '../electric'

type Props = {
  star: Star
}

const AllocatedStar = ({ star }: Props) => (
  <div className="allocated-star">
    <img src={star.avatar_url} className="avatar" />
  </div>
)

export default AllocatedStar
