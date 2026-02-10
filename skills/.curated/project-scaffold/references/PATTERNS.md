# File Organization Patterns

Common project structures and when to use them.

## Flat Module (Small Projects)

```
src/
  auth.ts
  auth.test.ts
  database.ts
  database.test.ts
  server.ts
  index.ts
```

Best for: small projects, scripts, CLI tools under ~20 files.

## Feature-Based (Medium Projects)

```
src/
  auth/
    auth.ts
    auth.test.ts
    middleware.ts
    types.ts
    index.ts
  users/
    users.ts
    users.test.ts
    repository.ts
    types.ts
    index.ts
  shared/
    errors.ts
    logger.ts
```

Best for: medium projects, APIs, services. Each feature is self-contained.

## Layer-Based (Traditional)

```
src/
  controllers/
    auth.controller.ts
    user.controller.ts
  services/
    auth.service.ts
    user.service.ts
  repositories/
    auth.repository.ts
    user.repository.ts
  models/
    user.model.ts
  middleware/
    auth.middleware.ts
  types/
    auth.types.ts
```

Best for: projects with strict separation of concerns. Common in enterprise.

## Monorepo (Large Projects)

```
packages/
  core/
    src/
    test/
    package.json
  api/
    src/
    test/
    package.json
  ui/
    src/
    test/
    package.json
pnpm-workspace.yaml
tsconfig.base.json
```

Best for: large projects with multiple publishable packages or deployable services.

## Colocation Rules

| Item | Place it... |
|---|---|
| Test file | Next to source file, or in mirror `test/` directory |
| Types | In the module that defines them, or `types.ts` in feature dir |
| Constants | In `constants.ts` at feature or shared level |
| Utils | In `utils/` at shared level, or inline if only used once |
| Config | At project root, or in `config/` directory |

## Naming Conventions by Ecosystem

| Ecosystem | Files | Dirs | Classes | Functions |
|---|---|---|---|---|
| TypeScript/Node | kebab-case | kebab-case | PascalCase | camelCase |
| React | PascalCase (components) | kebab-case | PascalCase | camelCase |
| Python | snake_case | snake_case | PascalCase | snake_case |
| Rust | snake_case | snake_case | PascalCase | snake_case |
| Go | snake_case | lowercase | PascalCase (exported) | PascalCase/camelCase |

## Anti-Patterns

- **God directory**: `src/utils/` with 50 unrelated files. Split by domain.
- **Circular imports**: A imports B imports A. Restructure or extract shared code.
- **Deep nesting**: `src/modules/auth/services/internal/helpers/`. Flatten.
- **Inconsistent structure**: Some features in `src/`, others in `lib/`. Pick one.
- **Test divorce**: Tests in a completely separate tree from source. Colocate when possible.
