# LOOP.md — RadarView Loop Configuration

## Active Loops

| Pattern | Cadence | Status | Command |
|---------|---------|--------|---------|
| Performance Optimization | 5m | L3 unattended | See below |

## Performance Optimization Loop

- **Goal**: Improve FPS and memory usage across 3D/2D rendering, data import, and replay
- **Cadence**: 5m during active hours, 1d off-hours
- **Isolation**: Each optimization attempt runs in an isolated git worktree
- **Max attempts per item**: 3 → escalate to human with full context
- **Verifier**: Independent loop-verifier agent (different model)
- **Metric baseline**: FPS + memory captured before each optimization attempt

## Phases

| Phase | Action |
|-------|--------|
| 1. Baseline | Capture current FPS/memory metrics |
| 2. Triage | Identify top performance hotspot |
| 3. Implement | Apply targeted fix in worktree |
| 4. Verify | Independent verifier checks FPS + memory + no regression |
| 5. Merge | If verifier APPROVES, apply to main branch |

## Human Gates

- No auto-fix until L2 checklist complete
- All high-risk paths: human review required
- No auto-commit without user confirmation
- Kill switch: `loop-pause-all` — pause schedulers and notify human

## Budget

- Max sub-agent spawns per run: 2
- Max tokens/day: 500000k (per user "+500000k" directive)
- Kill switch: `loop-pause-all` — pause schedulers and notify human

## Links

- Design checklist: [loop-design-checklist](docs/loop-design-checklist.md)
- Safety: [safety](docs/safety.md)
- Failure modes: [failure-modes](docs/failure-modes.md)
