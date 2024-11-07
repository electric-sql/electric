# Electric Swift client

WIP: initial sketch of a Swift client.

## Notes

- `ElectricShape` **Class**: This class manages the synchronization and data handling for a single ElectricSQL shape.
- `@Published` **Property Wrapper**: This makes the `data` property observable, allowing you to update UI elements or other parts of your application whenever the shape data changes.
- **Initialization**: The `init` method sets up the base URL, table name, and optional where clause for the shape.
- `subscribe` **Method**: Allows other parts of your application to subscribe to data changes.
- `sync` **Method**: Starts an asynchronous task that continuously polls for updates from the ElectricSQL server.
- `request` **Method**: Constructs the API request URL and handles the HTTP request/response cycle.
- `processMessages` **Method**: Parses and applies the incoming changes from the server to the local data dictionary.
- `applyOperation` **Method**: Handles the different operation types ("insert", "update", "delete") received from the server.
- `notifySubscribers` **Method**: Notifies any subscribers about changes in the data.
- `buildUrl` **Method**: Dynamically constructs the URL for the API request based on the current state of the ElectricShape object.

N.b.:

- includes basic error handling, but a production-ready client should have more robust error handling, including:
  - Retrying failed requests with exponential backoff.
  - Handling network connectivity issues.
  - Gracefully handling different HTTP error codes.
- sync method runs indefinitely; implement a mechanism to stop the sync when done
