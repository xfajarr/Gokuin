# Planning artifacts

ETHOnline's rules allow spec-driven and AI-assisted workflows provided the spec
files, prompts and planning artifacts live in the repo. This directory is that
record, alongside [PRD.md](../PRD.md).

| File | What |
|---|---|
| [decisions.md](./decisions.md) | Every direction the project changed, why, and what forced it |
| [agent-briefs.md](./agent-briefs.md) | The task briefs each implementation agent was given |
| [../PRD.md](../PRD.md) | The spec the build was executed against |

The measurement definitions in `packages/core/src/metrics.ts` were written by hand
before any implementation existed, and everything else was built against them.
That ordering is the reason a contract, an API, a subgraph and a UI can be
generated separately and still agree on what a sandwich cost.
