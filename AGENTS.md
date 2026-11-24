## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Rules

- NEVER use Unicode emojis (e.g., 🚀, 📦, ⚠️, ❌, ✅) in generated UI, code, or Markdown responses.
- Always use inline SVG elements or the project's SVG icon set for visual indicators and icons.
- Never push to git without explicit user permission; otherwise only make local commits.
- Do NOT run tests (e.g., `vitest`) on every change; only run the test suite before pushing to git. Always run `npm run build` and ensure the build succeeds after changes.
- Prioritize modularity: extract reusable components (e.g., SearchBar) whenever you spot recurring patterns, and reuse existing components rather than reimplementing them.
- Keep UI copy minimal and direct: do NOT add explanatory paragraphs, filler subtitles, or redundant helper text under headings, cards, settings rows, or buttons unless the user explicitly asks for them. Titles and labels must be self-explanatory.
- Avoid generic "AI-generated" UI clichés: avoid wrapping every section in nested glowing rounded cards, avoid redundant status pills/badges, avoid decorative gradients/eyebrows where clean typography and flat structural dividers work better.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
