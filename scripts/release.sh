#!/usr/bin/env bash
set -euo pipefail

# Husk one-click release script
# Usage: ./scripts/release.sh [patch|minor|major|x.y.z]
# Defaults to 'patch' if no argument given.

BUMP="${1:-patch}"
cd "$(dirname "$0")/.."

# Pull latest
echo "→ Pulling latest from origin..."
git pull origin main --tags --rebase

# Read current version
CURRENT=$(node -p "require('./package.json').version" | tr -d '\n')
echo "→ Current version: $CURRENT"

# Compute next version
if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  NEXT="$BUMP"
else
  NEXT=$(node -p "
    const [maj, min, patch] = '$CURRENT'.split('.').map(Number);
    if ('$BUMP' === 'major') \`
      \${maj + 1}.0.0\`;
    else if ('$BUMP' === 'minor') \`
      \${maj}.\${min + 1}.0\`;
    else \`
      \${maj}.\${min}.\${patch + 1}\`;
  " | tr -d '\n')
fi

echo "→ Next version: $NEXT"

# Update package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = '$NEXT';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Update Cargo.toml
sed -i.bak "s/^version = \"$CURRENT\"/version = \"$NEXT\"/" src-tauri/Cargo.toml
rm -f src-tauri/Cargo.toml.bak

# Stage, commit, tag
git add package.json src-tauri/Cargo.toml
git commit -m "chore(release): bump version to $NEXT"
git tag "v$NEXT"

echo "→ Pushing commit and tag..."
git push origin main
git push origin "v$NEXT"

echo ""
echo "✅ Release v$NEXT triggered."
echo "   GitHub Actions is building at:"
echo "   https://github.com/0xakikp/husk/actions"
echo "   Draft release will appear at:"
echo "   https://github.com/0xakikp/husk/releases"
