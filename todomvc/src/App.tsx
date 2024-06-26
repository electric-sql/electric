import { useState } from "react"

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <h1>ElectricSQL + React</h1>
      <div>
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
      </div>
    </>
  )
}

export default App
