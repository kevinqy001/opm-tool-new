# OPM 页面数据缓存（准备工作）

在拿到 API Endpoint / Key 之前，各页已接入统一的内存 JSON 缓存。

## 架构

| 文件 | 作用 |
|------|------|
| `opm-config.js` | API 地址、Key、`USE_MOCK_WHEN_UNAVAILABLE` |
| `opm-api-client.js` | `GET /series`、`POST /savedDrafts` 等请求 |
| `opm-data-store.js` | 内存数组 `cache.series`、`cache.savedDrafts` |
| `opm-page-bootstrap.js` | 页面加载时自动 `preload` |

## 各页加载什么

| 页面 | 加载时请求 | 缓存键 |
|------|------------|--------|
| Series Coverage | `GET /series` | `OpmDataStore.get("series")` |
| Saved Drafts | `POST /savedDrafts` `{}` | `OpmDataStore.get("savedDrafts")` |
| OPM | 不预加载推荐 | 仍由 Get Recommendation 按需调用 |

Series Coverage 页同时包含 Product Category / Product Series / Part Number 筛选（与表格搜索联动）。

## 没有 API 时

`USE_MOCK_WHEN_UNAVAILABLE: true`（默认）时，请求失败会使用内置 demo 数组，页面仍可开发和验收 UI。

Series 页底部会显示：`demo data (API unavailable)`。

## 拿到 API 之后

1. 编辑 `opm-config.js` 填写 `API_BASE_URL`、`API_KEY`
2. 用 `api-test/test_opm_api.py` 验证
3. 刷新页面；来源应变为 `live API`
4. 可将 `USE_MOCK_WHEN_UNAVAILABLE` 设为 `false`，强制只用真实数据

## 在控制台查看缓存

```javascript
OpmDataStore.snapshot()
```

## 事件

- `opm:data-ready` — 当前页预加载完成
- `opm:cache-updated` — 某一缓存桶更新
