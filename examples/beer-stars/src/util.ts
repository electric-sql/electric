export const splitStars = (beers: Beer[], stars: Star[]) => {
  const starIdsToBeers: { [key: string]: Beer} = {}
  beers.filter(({ star_id }) => star_id !== null).forEach((beer) => {
    starIdsToBeers[beer.star_id] = beer
  })

  const starsWithBeers: Star[] = []
  const starsWithoutBeers: Star[] = []
  stars.forEach((star) => {
    if (star.id in starIdsToBeers) {
      star.beers = [starIdsToBeers[star.id]]

      starsWithBeers.push(star)
    }
    else {
      starsWithoutBeers.push(star)
    }
  })

  return {
    starsWithBeers,
    starsWithoutBeers
  }
}
