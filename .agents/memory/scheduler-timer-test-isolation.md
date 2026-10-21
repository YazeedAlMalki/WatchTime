---
name: Scheduler timer test isolation
description: Real database recovery and pre-existing spies can contaminate fake-timer scheduler assertions.
---
Scheduler integration tests must distinguish database connection timers from refresh timers. Restore pre-existing global timer spies before switching to fake timers.

**Why:** Database recovery creates its own timeouts. Also, fake timers can capture an existing timer spy and reinstate it when real timers return, even after mock restoration; later tests then accumulate orphaned spy call history.

**How to apply:** Keep database recovery on real timers, capture refresh scheduling only after the isolated latest-history read, and clean up timers and mocks in a finally block.
