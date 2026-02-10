# Supported Test Frameworks

Reference for test file patterns, configuration, and commands.

## JavaScript / TypeScript

### Vitest

- **Config**: `vitest.config.ts`, `vitest.config.js`, `vitest.config.mts`
- **Pattern**: `*.test.ts`, `*.spec.ts`, `*.test.tsx`
- **Run**: `npx vitest run`
- **Watch**: `npx vitest`
- **Coverage**: `npx vitest run --coverage`
- **Filter**: `npx vitest run -t "pattern"` or `npx vitest run path/to/file`

### Jest

- **Config**: `jest.config.ts`, `jest.config.js`, `jest.config.json`
- **Pattern**: `*.test.ts`, `*.spec.ts`, `__tests__/*.ts`
- **Run**: `npx jest`
- **Watch**: `npx jest --watch`
- **Coverage**: `npx jest --coverage`
- **Filter**: `npx jest --testPathPattern="pattern"`

### Mocha

- **Config**: `.mocharc.yml`, `.mocharc.json`
- **Pattern**: `test/**/*.js`, `test/**/*.ts`
- **Run**: `npx mocha`
- **Watch**: `npx mocha --watch`

### Node.js Built-in

- **Config**: None
- **Pattern**: `*.test.js`, `*.test.mjs`
- **Run**: `node --test`
- **Coverage**: `node --test --experimental-test-coverage`

## Python

### Pytest

- **Config**: `pytest.ini`, `pyproject.toml [tool.pytest]`, `setup.cfg`
- **Pattern**: `test_*.py`, `*_test.py`
- **Run**: `pytest`
- **Coverage**: `pytest --cov=src --cov-report=term-missing`
- **Filter**: `pytest -k "pattern"` or `pytest path/to/test.py::test_name`
- **Verbose**: `pytest -v`
- **Parallel**: `pytest -n auto` (with pytest-xdist)

### unittest

- **Pattern**: `test_*.py` in `tests/` directory
- **Run**: `python -m unittest discover -s tests`

## Rust

### Cargo Test

- **Config**: `Cargo.toml`
- **Pattern**: `#[test]` annotations, `tests/` directory for integration
- **Run**: `cargo test`
- **Filter**: `cargo test test_name`
- **Verbose**: `cargo test -- --nocapture`

## Go

### Go Test

- **Config**: `go.mod`
- **Pattern**: `*_test.go`
- **Run**: `go test ./...`
- **Coverage**: `go test -coverprofile=coverage.out ./...`
- **Filter**: `go test -run TestName ./...`
- **Verbose**: `go test -v ./...`
- **Race**: `go test -race ./...`

## Coverage Targets

| Level | Line Coverage | Branch Coverage | Quality |
|---|---|---|---|
| Minimum | 60% | 40% | Barely acceptable |
| Good | 80% | 65% | Solid for most projects |
| Excellent | 90%+ | 80%+ | Production-critical code |

Focus coverage on business logic and error paths, not boilerplate.
