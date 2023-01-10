import { ConsoleClient } from '../satellite'

export class MockConsoleClient implements ConsoleClient {
  token = () =>
    Promise.resolve({ token: 'MOCK_TOKEN', refreshToken: 'MOCK_REFRESH_TOKEN' })
}
