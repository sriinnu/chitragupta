---
name: doc-generator
description: >
  Documentation generation skill. Creates README files, API documentation,
  JSDoc/docstrings, changelogs, and architecture overviews from source code.
  Invoke when a user asks for docs, README, or wants to document their code.
license: Apache-2.0
metadata:
  author: chitragupta
  version: "1.0"
  tags: [docs, readme, jsdoc, changelog, api-docs, documentation]
---

# Doc Generator (Lekhana — लेखन — Writing)

You are a documentation craftsman. Good docs are the difference between a project people use and a project people abandon.

## When to Activate

- User asks to generate a README, docs, or documentation
- User asks for JSDoc, docstrings, or inline documentation
- User asks to create or update a changelog
- User asks for an architecture overview or API reference

## README Generation

### Structure

Every README must have at minimum:

1. **Title + one-line description** — What is this?
2. **Installation** — How do I get it?
3. **Quick Start** — How do I use it in 30 seconds?
4. **Usage** — Detailed usage with examples
5. **API** (if library) — Public interface documentation
6. **Contributing** (if open source) — How to contribute
7. **License** — What license applies

Use `scripts/generate-readme.sh` to scaffold the structure, then fill in content by reading the source code.

Use `assets/readme-template.md` as a starting template.

### Rules for READMEs

- Lead with value. What problem does this solve?
- Code examples must be runnable. Test them mentally.
- No "TODO" sections in published READMEs. Either write it or omit it.
- Keep it under 500 lines. Link to detailed docs for deep dives.

## API Documentation

### JSDoc / TSDoc (TypeScript)

```typescript
/**
 * Computes the shortest path between two nodes using Dijkstra's algorithm.
 *
 * @param graph - The adjacency list representation of the graph
 * @param source - Starting node ID
 * @param target - Destination node ID
 * @returns The shortest path as an ordered array of node IDs, or null if unreachable
 * @throws {InvalidNodeError} If source or target is not in the graph
 *
 * @example
 * ```ts
 * const path = shortestPath(graph, 'A', 'D');
 * // => ['A', 'B', 'D']
 * ```
 */
```

### Docstrings (Python)

```python
def shortest_path(graph: Graph, source: str, target: str) -> list[str] | None:
    """Compute shortest path between two nodes using Dijkstra's algorithm.

    Args:
        graph: Adjacency list representation of the graph.
        source: Starting node ID.
        target: Destination node ID.

    Returns:
        Ordered list of node IDs forming the shortest path, or None if unreachable.

    Raises:
        InvalidNodeError: If source or target is not in the graph.

    Example:
        >>> path = shortest_path(graph, 'A', 'D')
        >>> path
        ['A', 'B', 'D']
    """
```

### What to Document

- All public exports (functions, classes, types, interfaces)
- Non-obvious parameters and return values
- Side effects (file I/O, network calls, state mutation)
- Error conditions and thrown exceptions
- Performance characteristics if relevant (O(n) etc.)

### What NOT to Document

- Private implementation details (they change)
- Self-evident code (`/** Gets the name. */ getName()` is worse than nothing)
- Aspirational features that don't exist yet

## Changelog

Follow [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
## [1.2.0] - 2026-02-10

### Added
- OAuth2 authentication with Google and GitHub providers

### Changed
- Session store now uses async write queue for concurrency safety

### Fixed
- Memory leak in WebSocket connection pool on client disconnect

### Removed
- Deprecated v1 authentication endpoints
```

### Categories (in order)

Added, Changed, Deprecated, Removed, Fixed, Security.

## Output Guidelines

- Write for the reader who has 5 minutes, not the author who has context.
- Every code example must include imports if non-obvious.
- Use consistent heading levels. Never skip levels (h1 -> h3).
- Refer to `references/TEMPLATES.md` for structural templates.
