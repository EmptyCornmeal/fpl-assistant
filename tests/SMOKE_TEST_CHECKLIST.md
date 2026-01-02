# FPL Assistant - Smoke Test Checklist

Phase 9: QA, Performance, and "Feels like a product"

## Pre-Test Setup

- [ ] Clear browser cache and localStorage
- [ ] Open browser DevTools (Console + Network tabs)
- [ ] Have a valid FPL Entry ID ready

---

## 1. Application Load & Navigation

### 1.1 Initial Load
- [ ] App loads without console errors
- [ ] Theme (dark/light) toggles correctly
- [ ] No CORS errors in console
- [ ] Loading spinners appear during data fetch

### 1.2 Hash Navigation
- [ ] `#/` - Portal page loads
- [ ] `#/team` - My Team page loads
- [ ] `#/all-players` - All Players page loads
- [ ] `#/fixtures` - Fixtures page loads
- [ ] `#/stat-picker` - Stat Picker loads (after password gate)
- [ ] `#/meta` - Meta page loads
- [ ] `#/gw-explorer` - GW Explorer loads
- [ ] `#/planner` - Planner page loads
- [ ] Browser back/forward buttons work correctly
- [ ] Direct URL navigation works (e.g., refresh on `#/team`)

---

## 2. Portal (Home) Page

- [ ] Dashboard tiles render correctly
- [ ] GW info displays current/next GW
- [ ] Quick stats show team value, rank, points
- [ ] Navigation links to other pages work
- [ ] No layout broken on mobile/tablet widths

---

## 3. My Team Page

- [ ] Squad loads with 15 players
- [ ] Pitch visualization renders correctly
- [ ] Player cards show name, team, price
- [ ] Captain/Vice-Captain indicators visible
- [ ] Bench players clearly distinguished
- [ ] xP projections display (if computed)
- [ ] Skeleton loading appears while fetching

---

## 4. All Players Page (Performance Critical)

### 4.1 Initial Render
- [ ] Table loads with first chunk of players (50)
- [ ] "Load More" / "Load All" buttons visible
- [ ] Search input is responsive
- [ ] Filter dropdowns work (Position, Team, Status)

### 4.2 Progressive Rendering
- [ ] Clicking "Load More" adds more rows
- [ ] Clicking "Load All" renders all 600+ players
- [ ] No UI freeze during large render
- [ ] Status bar shows "Showing X of Y"

### 4.3 Filtering & Sorting
- [ ] Search by player name works (e.g., "Salah")
- [ ] Accent-insensitive search works (e.g., "Odegaard" → Ødegaard)
- [ ] Position filter works correctly
- [ ] Price range filter works
- [ ] Column sorting works (click header)
- [ ] Sort direction toggles (asc/desc)

### 4.4 Chart
- [ ] Scatter chart renders
- [ ] Chart mode toggle works (Points/xP)
- [ ] Chart points are interactive (tooltip)

### 4.5 Compare Feature
- [ ] Can select 2 players with checkboxes
- [ ] Compare bar appears at bottom
- [ ] Compare modal opens and shows stats
- [ ] Clear button works

---

## 5. Fixtures Page

- [ ] Fixtures table loads for all gameweeks
- [ ] FDR colors display correctly
- [ ] Team names/badges render
- [ ] Fixture difficulty visible
- [ ] Blank gameweek detection works

---

## 6. Stat Picker (Password-Gated)

### 6.1 Gate
- [ ] Password gate appears on first visit
- [ ] Correct password unlocks (default: "fpl2025")
- [ ] Unlock persists for 24 hours
- [ ] Wrong password shows error

### 6.2 Dashboard
- [ ] Dependencies load with status indicators
- [ ] Horizon selector works (This GW, Next 3, Next 5)
- [ ] Objective selector works
- [ ] Captain mode toggle works

### 6.3 Transfer Optimizer (Phase 7)
- [ ] Weakest links table shows players
- [ ] Expendability scores display with reasons
- [ ] Transfer recommendations appear
- [ ] Lock player toggle works
- [ ] Exclude team toggle works
- [ ] Hit threshold slider works

### 6.4 Bench Optimizer (Phase 8)
- [ ] Bench order recommendations display
- [ ] Suboptimal warning appears if applicable
- [ ] Chip suggestions show (BB/TC)
- [ ] Confidence levels display

---

## 7. API & Caching

- [ ] First load fetches from API
- [ ] Second load uses cache (faster)
- [ ] Cache age indicator shows correctly
- [ ] "Refresh" button forces API fetch
- [ ] Degraded mode works when offline
- [ ] Error cards show retry button

---

## 8. Performance Checks

### 8.1 Initial Load
- [ ] First Contentful Paint < 2s
- [ ] Time to Interactive < 3s
- [ ] No layout shift after load

### 8.2 All Players Table
- [ ] Initial render < 500ms
- [ ] Filter response < 100ms
- [ ] Full table render (600 rows) < 2s
- [ ] Scroll is smooth (60fps)

### 8.3 Transfer Optimizer
- [ ] xP calculations complete < 5s
- [ ] Progress indicator shows during calculation
- [ ] UI remains responsive during computation

### 8.4 Memory
- [ ] No memory leaks (check DevTools Memory tab)
- [ ] Page doesn't grow memory on repeated navigation

---

## 9. Error Handling

- [ ] Invalid Entry ID shows helpful error
- [ ] Network failure shows retry option
- [ ] API rate limit handled gracefully
- [ ] Empty states have helpful messages

---

## 10. Mobile/Responsive

- [ ] Layout works on mobile (360px width)
- [ ] Tables scroll horizontally
- [ ] Modals are usable on mobile
- [ ] Touch interactions work (tap, scroll)
- [ ] No horizontal overflow on pages

---

## Test Results

| Section | Pass | Fail | Notes |
|---------|------|------|-------|
| 1. Navigation | | | |
| 2. Portal | | | |
| 3. My Team | | | |
| 4. All Players | | | |
| 5. Fixtures | | | |
| 6. Stat Picker | | | |
| 7. API/Caching | | | |
| 8. Performance | | | |
| 9. Error Handling | | | |
| 10. Mobile | | | |

**Overall Status:** ☐ PASS ☐ FAIL

**Tested By:** _______________
**Date:** _______________
**Browser/Version:** _______________
**Device:** _______________

---

## Notes

_Record any issues, observations, or regressions here:_

```
```
