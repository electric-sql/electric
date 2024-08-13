async function main() {
  const res = await fetch(`http://localhost:5174/api/workers`, {
    method: `POST`,
  })
  const { id } = await res.json()
  console.log({ id })
}

main()
