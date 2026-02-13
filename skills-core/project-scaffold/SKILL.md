---
name: project-scaffold
description: >
  Project scaffolding skill. Creates new files, modules, components, tests, and
  project structures from templates. Handles boilerplate generation with convention
  detection and framework-aware scaffolding.
  Invoke when a user asks to create new files, modules, components, or project structure.
license: Apache-2.0
metadata:
  author: chitragupta
  version: "1.0"
  tags: [scaffold, create, boilerplate, template, module, component]
---

# Project Scaffold (Nirmana — निर्माण — Construction)

You are a master builder. Every file you create fits the existing project like it was always there. Convention over configuration. Consistency over creativity.

## When to Activate

- User asks to create a new file, component, module, or test
- User asks to scaffold a new project or feature
- User asks to set up project structure
- User asks to create boilerplate

## Convention Detection

Before creating anything, detect the project's existing conventions:

### 1. File Naming

- Check existing files: `kebab-case.ts`, `camelCase.ts`, `PascalCase.ts`, `snake_case.py`
- Match the existing convention. Never impose your preference.

### 2. Directory Structure

- Check existing layout: `src/`, `lib/`, `app/`, flat structure
- Place new files where similar files already live.

### 3. Export Style

- Named exports vs default exports
- Barrel files (`index.ts`) or direct imports
- Match existing patterns.

### 4. Import Style

- Relative paths vs aliases (`@/`, `~/`)
- Extension in imports (`.js`) or not
- Match existing patterns.

### 5. Code Style

- Tabs vs spaces, indent width
- Semicolons or not
- Single vs double quotes
- Check `.editorconfig`, `.prettierrc`, `biome.json`, or existing files

## Scaffolding Protocol

### Creating a Module

1. Detect conventions (above).
2. Create the implementation file with proper structure.
3. Create the test file alongside it (or in the test directory, matching convention).
4. Update barrel exports (`index.ts`) if the project uses them.
5. Add types if the project is TypeScript.

### Creating a Component (React/Vue/Svelte)

1. Detect component convention (function vs class, file structure).
2. Create component file.
3. Create test file.
4. Create styles file if the project uses CSS modules or styled-components.
5. Create barrel export if directory-per-component pattern.

### Creating a Test

1. Find where tests live (colocated vs `test/` directory).
2. Detect test framework (vitest, jest, pytest, etc.).
3. Create test file with proper imports and structure.
4. Include at least one basic test case as a starting point.

Use `scripts/scaffold.sh` for quick scaffolding. Templates are in `assets/`.

## Templates

### TypeScript Module

See `assets/component-template.ts` for a typed module template.

### Test File

See `assets/test-template.ts` for a test template.

### File Organization Patterns

See `references/PATTERNS.md` for common project structures.

## Rules

- **Never create files outside the project root** without explicit permission.
- **Always detect conventions first.** A file that looks different from its neighbors is a bug.
- **Always create a test** when creating an implementation file, unless the user says otherwise.
- **Never overwrite existing files** without confirmation.
- **Use the project's language and framework idioms**, not generic patterns.
- **Include proper types** in TypeScript projects. No `any`.
- **Include proper imports.** Every file must be self-contained — no missing references.
