# Common Anti-Patterns

Reference sheet for the code-review skill. When reviewing, check for these.

## JavaScript / TypeScript

| Pattern | Problem | Fix |
|---|---|---|
| `any` type | Disables type safety | Use proper types or `unknown` |
| `== null` without strict | Loose equality confusion | Use `=== null \|\| === undefined` or `== null` deliberately |
| Unhandled promise rejection | Silent failures | Add `.catch()` or use try/catch with await |
| `for...in` on arrays | Iterates prototype keys | Use `for...of` or `.forEach()` |
| Mutable default params | Shared reference mutation | Spread or clone defaults |
| `delete obj.key` | Deoptimizes V8 hidden classes | Use Map or set to `undefined` |
| Nested callbacks >3 deep | Callback hell | Refactor to async/await |
| `JSON.parse` without try | Throws on invalid input | Wrap in try/catch |
| String concatenation in loops | O(n^2) string building | Use array + `.join()` |
| Missing `AbortSignal` | Leaked async operations | Pass and respect AbortSignal |

## Python

| Pattern | Problem | Fix |
|---|---|---|
| Mutable default arg `def f(x=[])` | Shared state across calls | Use `None` + create inside |
| Bare `except:` | Catches SystemExit, KeyboardInterrupt | Catch specific exceptions |
| `is` for value comparison | Identity vs equality | Use `==` for values |
| Global state mutation | Hard to test, race conditions | Pass state explicitly |
| `os.system()` | Shell injection risk | Use `subprocess.run()` |

## General

| Pattern | Problem | Fix |
|---|---|---|
| Magic numbers | Unreadable, unmaintainable | Named constants |
| God functions (>50 lines) | Hard to test and reason about | Extract sub-functions |
| Swallowed errors (empty catch) | Silent data corruption | Log or re-raise |
| Hardcoded paths/URLs | Breaks across environments | Config or env vars |
| Missing input validation | Injection, crashes | Validate at boundaries |
| Synchronous file I/O in async code | Blocks event loop | Use async I/O |
| Retry without backoff | Thundering herd | Exponential backoff + jitter |
| Unbounded collections | Memory leak | Set max size, use LRU |
| Logging secrets | Credential leak | Redact sensitive fields |
| Time-of-check-time-of-use | Race condition | Atomic operations |

## Security Red Flags

- User input used in SQL without parameterization
- User input used in shell commands without escaping
- User input rendered in HTML without encoding
- Credentials in source code or config files committed to git
- `eval()` or `new Function()` with dynamic input
- Disabled TLS verification (`rejectUnauthorized: false`)
- Overly permissive CORS (`Access-Control-Allow-Origin: *`)
- Missing rate limiting on public endpoints
- Missing authentication on sensitive endpoints
- Predictable session tokens or IDs
