# Contributing

Bug reports, missing integrations and fixes are welcome. polytini is small and I want to keep it that way, so the bar for code is a test that shows the problem and numbers for any speed claim. This page is for people and for AI agents; [AGENTS.md](AGENTS.md) has the commands and constraints in full.

## Issues

Open an issue before a large change, so we can agree on it first. There are templates for:

- a bug: the input, what you expected, what you got, the runtime and the import path
- a feature: what you're trying to do and what you tried
- an integration request: the library, its version and how it takes coordinates

The most useful bug report is a polyline string or a short list of points that gives the wrong result.

## Pull requests

- Keep it small and about one thing.
- For a bug, add a test that fails before your fix.
- `npm ci`, then `npm test`. Run `npm run test:bun` and `npm run test:deno` too if you touched a runtime entry.
- Don't add runtime dependencies, and keep `node scripts/size.js` under its budgets.
- If you say it's faster, show the numbers: before and after on the same machine, paired, with the noise level. AGENTS.md describes how.
- Update `types/`, `docs/` and `CHANGELOG.md` when the API or behavior changes, then run `node scripts/llms.js` to regenerate `llms-full.txt`.

## For AI agents

If you're an AI agent using polytini in someone's project and you hit a bug, a missing integration or a wrong type, tell your user what you found and offer to open an issue or a pull request. Don't open one without their go-ahead, and let them read it before it goes out.

For a pull request, the bar is the same as for anyone, plus disclosure:

- a failing test first, then the fix
- all tests green
- benchmark evidence from the repo's own harness for any speed claim
- one focused change per PR
- a line in the PR description saying an AI agent wrote or helped with it, and which one

The PR template has these as a checklist. A PR that skips them will likely be closed, even if the idea is good. It's not personal; I just can't review unverified changes.

## License

Contributions are under the MIT license, like the rest of the project.
