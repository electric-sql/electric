import { MockCommitNotifier } from '../../src/notifiers/mock'
import { MockElectricWorker } from '../../src/drivers/browser/mock'

// XXX These functions become available to add to an
// open database using `db.create_function`.
self.user_defined_functions = {
  addTwoNumbers: (a, b) => {
    return a + b
  }
}

const notifier = new MockCommitNotifier('test.db')
const ref = new MockElectricWorker(self, {commitNotifier: notifier})
