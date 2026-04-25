#!/usr/bin/env python3
"""
Update version badge and cache-busting in index.html from current Git tag.
Run this before uploading to Kasserver.
"""
import subprocess
import re
import sys
from datetime import datetime

def get_git_version():
    """Get the latest Git tag, fallback to git describe."""
    try:
        # Try annotated tags first
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"],
            capture_output=True, text=True, check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError:
        try:
            result = subprocess.run(
                ["git", "describe", "--tags"],
                capture_output=True, text=True, check=True
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError:
            return "v?.?.?"

def update_index_html():
    with open("index.html", "r", encoding="utf-8") as f:
        content = f.read()

    version = get_git_version()
    date_str = datetime.now().strftime("%Y%m%d")

    # Update version badge (id="versionBadge")
    content = re.sub(
        r'(<span class="version-badge" id="versionBadge">)[^<]*(</span>)',
        rf'\g<1>{version}\g<2>',
        content
    )

    # Update app.js cache-busting query string
    content = re.sub(
        r'(src="app\.js)\?[^"]*"',
        rf'\g<1>?v={date_str}"',
        content
    )

    with open("index.html", "w", encoding="utf-8") as f:
        f.write(content)

    print(f"✓ Version badge updated to {version}")
    print(f"✓ Cache-busting updated to v={date_str}")
    return version

if __name__ == "__main__":
    version = update_index_html()
    print(f"\nReady to upload with version {version}")
