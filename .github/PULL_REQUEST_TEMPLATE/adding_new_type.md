This PR adds support for type `TYPE` across the system.

The following requirements should be fulfilled for the new type:
- [ ] Decide on the format to convert values of the type from their PG text encoding into a more appropriate form on the client (if necessary to simplify working with values of this type within our TypeScript/DAL/SQLite stack).
- Server:
  - [ ] Implement a decoding function to transform a value from its PG text encoding into the Satellite protocol wire format.
  - [ ] Implement a decoding/validation function for the type on the server to convert values from the Satellite protocol wire format into PG-compatible text encoding.
  - [ ] Add the type to the allowlist that is consulted by the electrify() function.
- Generator:
  - [ ] Make the necessary changes to our generator to enable conversion from a value of the type stored in SQLite to a JS-native object, making sure all the necessary validations for values of that type are also implemented.
- Client: 
  - [ ] Implement a validation function for the type on the client using zod if they cannot be made a part of the generator tool.
- E2E:
  - [ ] Add an E2E test that verifies correct validation and syncing of values of the new type between Electric and Satellite clients in both directions.
  - [ ] If feasible, write a generative test that can generate random values of the type both on the client and on the server and verify that is a client validation passes, the value can be successfully written on the server as well.
