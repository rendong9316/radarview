#!/bin/bash
branch=$(git branch --show-current 2>/dev/null)
case "$branch" in
  feature/*|fix/*)
    if ! git diff --cached --name-only 2>/dev/null | grep -q 'docs/milestones.md'; then
      echo '{"systemMessage":"⚠️ 提醒：本次提交未包含 docs/milestones.md 的改动，请确认是否需要更新 checklist。"}'
    fi
    ;;
esac
