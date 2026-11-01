---
name: Admin content tab state
description: Preserving Content review state while navigating between admin tabs.
---

The admin URL intentionally removes Content-only filters while another tab is selected. When the Content panel needs to survive tab switches, keep it mounted after first visit and retain the alias search and ownership values while hidden; restore those values when Content is selected again. Otherwise the panel's filter-change effects treat tab navigation as a new review and clear saved correction previews even though the component stayed mounted.

**Why:** A failed-refresh correction and its warning are local review state tied to the active search and ownership filter. Mount persistence alone does not preserve the review if those props reset during tab navigation.

**How to apply:** For Content-local state that must survive admin-tab changes, test the complete return path, including props derived from URL filters. Avoid changing the general URL contract unless broader filter persistence is intended.
