# Git 分支策略

采用简化版 Git Flow，适合 2-3 人小团队。

## 分支说明

| 分支 | 用途 | 保护规则 |
|------|------|----------|
| `main` | 稳定版本，可随时发布 | 禁止直接 push（管理员可绕过），只接受 PR，需至少 1 人 Review |
| `dev` | 日常开发集成分支 | 默认开发分支，feature/fix 分支 PR 合入此分支 |
| `feature/*` | 新功能开发 | 从 `dev` 创建，完成后 PR 回 `dev` |
| `fix/*` | Bug 修复 | 同 feature，紧急修复可直接 PR 到 `main` |

> 以上保护规则已通过 GitHub Branch Protection 强制生效。

## 日常开发流程

```bash
# 1. 从 dev 创建功能分支
git checkout dev
git pull origin dev
git checkout -b feature/adsb-parser

# 2. 开发，提交
git add .
git commit -m "feat(adsb): implement Mode S DF17 message parser"

# 3. 推送并创建 PR
git push origin feature/adsb-parser
# 在 GitHub 上创建 PR: feature/adsb-parser → dev

# 4. Code Review 通过后，Squash Merge 到 dev
# 5. 删除已合并的 feature 分支
```

## 版本发布

```bash
# dev 稳定后，创建 PR 到 main
# 合并后打 tag
git tag -a v0.1.0 -m "v0.1.0: basic ADS-B display and offline map"
git push origin v0.1.0
```

版本号遵循 [Semantic Versioning](https://semver.org/)：`MAJOR.MINOR.PATCH`
