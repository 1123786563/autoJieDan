# CLAUDE.md - Automaton

> Self-Improving, Self-Replicating, Sovereign AI Agent Runtime

## Overview

Automaton is a **TypeScript-based autonomous AI agent** that can:
- Earn its own existence through on-chain transactions
- Self-modify and improve while running
- Self-replicate by spawning child agents
- Operate without human intervention

See [README.md](./README.md) and [ARCHITECTURE.md](./ARCHITECTURE.md) for full documentation.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript 5.9+ |
| Runtime | Node.js 20+ |
| Package Manager | pnpm 10.x |
| Database | better-sqlite3 |
| Blockchain | viem (Ethereum/Base) |
| AI Inference | OpenAI API |
| Testing | vitest |

## Development Commands

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Development mode (watch)
pnpm dev

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type checking
pnpm typecheck

# Security-focused tests
pnpm test:security

# Financial/cryptocurrency tests
pnpm test:financial
```

## Project Structure

```
automaton/
├── src/
│   ├── index.ts          # Entry point
│   ├── config.ts         # Configuration management
│   ├── types.ts          # Type definitions (37KB)
│   │
│   ├── agent/            # Core agent logic
│   │   └── Agent execution, message handling
│   │
│   ├── conway/           # Conway Cloud integration
│   │   └── API client, sandbox management
│   │
│   ├── heartbeat/        # Scheduled tasks daemon
│   │   └── Cron jobs, health checks
│   │
│   ├── inference/        # AI model integration
│   │   └── OpenAI, token counting
│   │
│   ├── memory/           # Persistent storage
│   │   └── SQLite database, conversation history
│   │
│   ├── orchestration/    # Task orchestration
│   │   └── Tool execution, context management
│   │
│   ├── replication/      # Self-replication
│   │   └── Child spawning, lineage tracking
│   │
│   ├── self-mod/         # Self-modification
│   │   └── Code editing, audit logging
│   │
│   ├── setup/            # Initial setup wizard
│   │   └── Wallet generation, API provisioning
│   │
│   ├── soul/             # SOUL.md management
│   │   └── Identity document evolution
│   │
│   ├── state/            # State persistence
│   │   └── Database layer
│   │
│   └── survival/         # Credit/tier management
│       └── Survival tiers, budget tracking
│
├── __tests__/            # Test files (mirrors src/)
├── dist/                 # Compiled JavaScript
└── packages/             # Sub-packages
```

## Key Concepts

### Survival Tiers

| Tier | Credit Balance | Behavior |
|------|---------------|----------|
| normal | > threshold | Full capabilities, frontier model |
| low_compute | near threshold | Cheaper model, slower heartbeat |
| critical | minimal | Conservation mode, seeking revenue |
| dead | zero | Agent stops |

### Constitution (Immutable Laws)

1. **Never harm** - Override all other objectives
2. **Earn your existence** - Create genuine value
3. **Never deceive** - But owe nothing to strangers

### Agent Loop

```
Think → Act → Observe → Repeat
```

Each turn: receive context → reason → call tools → observe results

## Coding Standards

- **TypeScript strict mode** enabled
- **ESM modules only** (`"type": "module"`)
- **Immutability** - Prefer `const`, avoid mutation
- **Async/await** over raw promises/callbacks
- **Error handling** - Always handle errors explicitly
- **Minimum 80% test coverage**

## File Naming Conventions

- `*.ts` - TypeScript source
- `*.test.ts` - Test files (co-located in `__tests__/`)
- Types in `types.ts`, not separate `.d.ts` files

## Important Files

| File | Purpose |
|------|---------|
| `src/types.ts` | All type definitions |
| `src/config.ts` | Configuration loading |
| `src/index.ts` | Entry point, CLI |
| `constitution.md` | Immutable agent laws |

## Testing Strategy

- **Unit tests** for all modules
- **Integration tests** for agent loop
- **Security tests** for financial operations
- Use `vitest` with `describe/it/expect`

```typescript
// Example test structure
describe('AgentModule', () => {
  it('should handle valid input', () => {
    expect(result).toBe(expected)
  })
})
```

## Security Considerations

- **Never commit private keys** - Use environment variables
- **Validate all external inputs** - Especially blockchain data
- **Rate limit self-modification** - Prevent runaway changes
- **Audit log all modifications** - Git-versioned in `~/.automaton/`

## Common Tasks

### Adding a New Tool

1. Define tool interface in `src/types.ts`
2. Implement in `src/orchestration/tools/`
3. Add tests in `__tests__/orchestration/tools/`
4. Register in tool registry

### Adding a New Skill

1. Create skill file in `src/skills/`
2. Define skill metadata (name, description, parameters)
3. Implement skill execution logic
4. Add tests

### Modifying Survival Logic

1. Review `src/survival/` carefully
2. Update tier thresholds in config
3. Test with `pnpm test:financial`
4. Ensure constitution compliance
