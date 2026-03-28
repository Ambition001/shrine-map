# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Commands

```bash
npm start          # Dev server (localhost:3000)
npm test           # Jest watch mode
npm test -- --watchAll=false  # Run tests once (CI mode)
npm test -- --testPathPattern=visits  # Run a single test file
npm run build      # Production build → build/
firebase deploy    # Deploy hosting + functions
firebase emulators:start --only functions  # Test Cloud Functions locally
```

## Architecture

React 19 SPA for tracking visits to Japan's 105 Ichinomiya shrines. Stack: Mapbox GL JS (map), Firebase Auth + Cloud Functions, Azure Cosmos DB (persistence), Tailwind CSS, IndexedDB (offline cache).

### Layer Hierarchy

```
App.js                    ← orchestrator: map init, auth state, view routing
  └── components/         ← pure UI (ShrineListView, ShrineDetailPanel, MergeConflictDialog, MapChoiceSheet, StatusBanners)
  └── hooks/              ← state management
        useAuth.js        ← auth state + sync lifecycle
        useVisits.js      ← visit data fetching (local or cloud)
  └── services/           ← business logic
        visits.js         ← CRUD, optimistic updates, merge conflict resolution
        auth.js           ← Firebase Auth (Google/Twitter providers)
        storage.js        ← IndexedDB wrapper (offline cache)
        firebase.js       ← Firebase SDK initialization
  └── data/shrines.json   ← 105 shrines (static, includes coords, region, prefecture)
  └── utils/shrineUtils.js ← GeoJSON generation, visit stats
```

### Storage Strategy

- **Unauthenticated**: reads/writes IndexedDB only
- **Authenticated**: Cloud Functions → Cosmos DB, with IndexedDB as cache
- **Pending ops queue**: offline writes queued in IndexedDB, synced on reconnect

### Sync / Merge Flow

On login, `smartMerge()` in `visits.js` compares local vs cloud visits. If conflict, `MergeConflictDialog` lets user pick: keep cloud, keep local, or merge both. `useAuth.js` owns this flow.

### Map Initialization

Mapbox GL is dynamically imported in `App.js` to reduce initial bundle. The GeoJSON source is rebuilt from `shrines.json` + visited state; red = unvisited, green = visited.

### Environment Variables

```
REACT_APP_MAPBOX_TOKEN          # Required for map
REACT_APP_AUTH_ENABLED          # Set false to use mock dev user (skips Firebase)
REACT_APP_API_URL               # Cloud function base URL (default: /api)
REACT_APP_FIREBASE_*            # 7 Firebase config vars
```

### Cloud Functions

`functions/index.js` — REST endpoints authenticated via Firebase ID tokens:
- `GET /visits` — fetch all visits
- `POST /visits/:shrineId` — mark visited
- `DELETE /visits/:shrineId` — unmark visited

Backed by Azure Cosmos DB via `@azure/cosmos` SDK. Cosmos client is lazily initialized.

## Testing

Tests live in `src/__tests__/`, `src/services/__tests__/`, and `src/hooks/__tests__/`. Uses Jest + React Testing Library + `fake-indexeddb` for storage tests. Mapbox GL is mocked at `src/__mocks__/mapbox-gl.js`.

Key test files: `visits.test.js` (CRUD + sync), `useAuth.test.js` (hook state), `App.mergeHandlers.test.js` (conflict resolution), `storage.test.js` (IndexedDB ops).

### E2E Tests (Playwright)

Two modes — use the right one for the situation:

```bash
npm run test:e2e      # 本地开发模式：复用已有 dev server，快速反馈
npm run test:e2e:ci   # CI 模拟模式：完全还原 CI 环境，push 前验证用
npm run test:e2e:ui   # 交互调试模式：Playwright UI，排查单个测试用
```

**`test:e2e`（本地开发）**：每次完整的代码改动后都要跑，验证没有引入破坏性改动。复用本地已有的 dev server（如果在跑），速度快。

**`test:e2e:ci`（CI 模拟）**：每次准备 push 之前必须先跑一次，确认通过再 push。使用 `CI=true`，完全还原 GitHub Actions 的运行方式：重新启动独立的 dev server、使用 `webServer.env` 里的变量（不依赖本地 `.env`）、开启重试。这样能在本地提前发现 CI 才会暴露的问题。
