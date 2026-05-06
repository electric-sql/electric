# Task prompt

Issue #8 from electric-sql/alco-agent-tasks: "FlushTracker stalling when tracked consumer dies out-of-band"

Write unit tests that exercise the edge case where a consumer process is tracked by FlushTracker but then dies independently (via handle_materializer_down with :shutdown reason), leaving a stale shape entry that permanently blocks flush advancement.

Key constraints:
- Use different approaches for each test
- Avoid mocking too many components
- Avoid inventing calls or messages inside the test body
- Try setting conditions so the app hits the edge case naturally
