# Documentation Templates

Structural templates for common documentation types.

## README Structure

```
# Project Name

One-line description.

## Installation
## Quick Start
## Usage
## API (if library)
## Configuration (if configurable)
## Development
## Contributing
## License
```

## API Reference Structure

```
# API Reference

## Module: auth

### `createToken(payload, options)`

Creates a signed JWT token.

**Parameters:**
| Name | Type | Required | Description |
|---|---|---|---|
| payload | object | Yes | Token payload |
| options.expiresIn | string | No | Expiry duration (default: "1h") |

**Returns:** `string` — Signed JWT token

**Throws:** `InvalidPayloadError` — If payload is empty

**Example:**
(code block)
```

## Architecture Document Structure

```
# Architecture Overview

## System Context
High-level diagram and description of the system and its environment.

## Components
Description of each major component and its responsibility.

## Data Flow
How data moves through the system.

## Key Decisions
ADRs (Architecture Decision Records) or summaries of important choices.

## Deployment
How the system is deployed and operated.
```

## Changelog Entry

```
## [version] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing features

### Fixed
- Bug fixes

### Security
- Security-related changes
```

## Migration Guide Structure

```
# Migrating from vX to vY

## Breaking Changes
List every breaking change with before/after examples.

## New Features
What's new that they should know about.

## Deprecations
What's deprecated and what replaces it.

## Step-by-Step Migration
1. Update dependency version
2. Run codemods (if available)
3. Fix breaking changes
4. Test
```
