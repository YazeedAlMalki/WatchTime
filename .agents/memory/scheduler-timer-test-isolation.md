---
name: Scheduler timer test isolation
description: Real database recovery and pre-existing spies can contaminate fake-timer scheduler assertions.
---
Scheduler integration tests must distinguish database connection timers from refresh timers. Restore pre-existing global timer spies before switching to fake timers.

**Why:** Database recovery creates its own timeouts. Also, fake timers can capture an existing timer spy and reinstate it when real timers return, even after mock restoration; later tests then accumulate orphaned spy call history.

**How to apply:** Keep database recovery on real timers, capture refresh scheduling only after the isolated latest-history read, and clean up timers and mocks in a finally block.

Scheduler cases also need ready database connections when run alone; a full-file pass can hide cold-pool timing dependencies.

**Why:** Successor recovery and detached worker startup overlap. Opening connections during that overlap changes lock-acquisition order, and opening them under fake clocks introduces unrelated timeout counts.

**How to apply:** Establish the needed real connections before installing fake clocks. Assert against captured refresh timers, not the pool's total timer count, and verify scheduler cases in separate test processes as well as together.

When a scheduling test successfully enqueues an empty run, its detached worker still opens database connections and starts history cleanup. Those timers can race later tests even though no provider requests run.

**Why:** A timer-transition test passed in isolation but the detached empty worker added or cleared pool timers during subsequent scheduler assertions.

**How to apply:** In tests focused only on scheduling, stub the worker's startup transaction and history cleanup, then wait for cleanup to finish before restoring fake timers.
