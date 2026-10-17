---
name: Internal publish probes
description: Internal startup-probe hostnames and Clerk key resolution in deployments.
---

Internal deployment startup probes can use an internal hostname that is absent from the public-host allowlist. Liveness must not depend on public-host selection or Clerk authentication.

**Why:** Production startup probes reached the server but failed because Clerk's publishable-key helper throws for an empty hostname before it considers its fallback key. Successful compilation therefore did not mean the deployment could become ready.

**How to apply:** Preserve the public-host allowlist for Clerk proxying and custom-domain selection. Keep only the public health GET/HEAD endpoint independent of authentication. If no trusted hostname is available for other requests, use the server-configured key rather than passing an empty hostname or trusting arbitrary forwarded headers. Verify protected requests still reject signed-out callers.
