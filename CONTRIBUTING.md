# Contributing to Husk

Thank you for your interest in contributing! This document outlines the steps to get started.

## How to Contribute

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/husk.git
   cd husk
   ```
3. **Create a branch** from `main` for your changes:
   ```bash
   git checkout -b feat/your-feature-name
   ```
4. **Make your changes** and ensure the project builds and runs correctly:
   ```bash
   pnpm install
   pnpm tauri dev
   ```
5. **Test** your changes thoroughly.
6. **Commit** your changes using [Git Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat(scope): description"
   ```
7. **Push** to your fork and open a **Pull Request** against the `main` branch.

## Commit Message Format

All contributors **must** use Git Conventional Commits. The format is:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Common types:
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation changes
- `style` — Code style changes (formatting, no logic change)
- `refactor` — Code refactoring
- `perf` — Performance improvements
- `test` — Adding or updating tests
- `chore` — Build process or auxiliary tool changes

## Code of Conduct

Be respectful and constructive in all interactions.
