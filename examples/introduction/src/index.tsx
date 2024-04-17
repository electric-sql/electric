import ReactDOM from 'react-dom'
// @ts-expect-error jsx files have no type declarations
import Demo from './demos/local-first/instant'

ReactDOM.render(<Demo />, document.getElementById('root'))
