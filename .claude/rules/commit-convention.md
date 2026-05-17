# Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <description>
```

## Type

| Type | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(map): add layer toggle control` |
| `fix` | Bug 修复 | `fix(adsb): correct altitude decoding for DF17` |
| `refactor` | 重构 | `refactor(track): simplify deduplication logic` |
| `docs` | 文档 | `docs: update data source configuration guide` |
| `style` | 代码格式 | `style: format with prettier` |
| `test` | 测试 | `test(replay): add time alignment unit tests` |
| `chore` | 构建/工具 | `chore: upgrade Tauri to 2.1` |

## Scope

建议使用模块名：`map`, `adsb`, `radar`, `track`, `replay`, `tiles`
