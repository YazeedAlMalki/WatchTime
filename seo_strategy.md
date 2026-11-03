# SEO Strategy

## In scope
- WatchTime public landing page, catalog browse/search, title and content-safety detail pages, and public movie discovery routes.
- Source-detectable WCAG 2.2 A/AA accessibility on public web surfaces.
- Mobile web entry/configuration where it exposes public content; native-only screens are not search landing pages.

## Out of scope
- Authenticated tracking, profiles, imports, statistics, administration, and internal design/mockup tooling.

## Target audience
- Viewers discovering and tracking movies, TV, anime, and documentaries, especially people seeking source-attributed content-safety information.

## Primary topics
- Movie and TV discovery, watch tracking, content safety, age classifications, and community safety guidance.

## Rendering and crawler assumptions
- WatchTime uses React/Vite client rendering; public content should be findable and shareable without requiring crawler JavaScript execution. Google may render JavaScript later; social and AI retrieval crawlers generally do not.
- The deployed application domain is canonical; no domain is assumed from development configuration.
- Public search and AI citation visibility are in scope. No intentional AI crawler blocking is documented.

## Dismissed categories
- None recorded.
