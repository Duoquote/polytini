## What and why

<!-- One change. Link the issue if there is one. -->

## Checklist

- [ ] A test that fails without this change (for a bug fix)
- [ ] `npm test` passes, and `npm run test:bun` / `npm run test:deno` if a runtime entry changed
- [ ] No new runtime dependencies, and `node scripts/size.js` is under budget
- [ ] Benchmark numbers for any speed claim: before and after, paired, on the same machine, with the commands used
- [ ] `types/`, `docs/` and `CHANGELOG.md` updated if the API or behavior changed, and `node scripts/llms.js` run

## AI assistance

<!-- Say whether an AI agent wrote or helped with this change, and which one. "None" is fine. -->
