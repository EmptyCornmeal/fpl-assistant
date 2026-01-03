# Changelog

## v1.0.0 (2026-01-03)

### Release Highlights
First production-ready release of FPL Dashboard.

### Phase 10 - Polish, Bugs & Product Hardening

#### Critical Fixes
- **Mini-League**: Fixed infinite loading issue. Now fetches leagues in parallel with proper error handling:
  - Shows individual league errors with retry buttons
  - Displays cached data with staleness indicator when API fails
  - Never spins forever - always shows explicit state

#### Trust & Correctness Fixes
- **Stat Picker - Allow Hits**: When hits are disabled:
  - No hit paths are generated
  - All hit-related UI is hidden (threshold slider, hit options section)
  - Shows "No Legal Transfers" when FT=0 and hits disabled
  - Forces recompute when toggling

#### UI Clarity Improvements
- **Transfer Horizon**: Renamed section to "Transfers (Next X GWs)" with tooltip explaining optimization scope
- **Pin/Lock UX**:
  - First-time pin shows one-time toast explaining behavior
  - Added "Clear all pins" button
  - Pinned rows visually distinguished with accent highlight

#### Desktop Polish
- **Sidebar**: Enhanced tooltip shows expand/collapse state with keyboard shortcut (S)
- **Fixtures**: Reduced vertical padding for better 4K above-fold matrix
- **GW Explorer**: Added proper card styling for Summary and TOTW sections

#### Table Affordances
- **Sort Indicators**: Clear arrow icons on active sort column with background highlight
- **Overflow Gradient**: Right-edge gradient indicator when table has horizontal overflow
- **Smart Detection**: Gradient fades when scrolled to rightmost position

#### Loading & Error Consistency
- **Skeleton Loading**: Spinner transitions to skeleton animation after 300ms
- **Standardized Errors**: Consistent error cards with icon, title, message, and actions

#### Performance
- **Smart Recompute**: Transfer optimizer caches results and only recomputes when parameters change
- **Dev Timing**: Performance logs in dev mode for profiling
- **Memoization**: Added caching for squad ranking and candidate pool calculations

### Previous Phases
- Phase 9: Performance optimizations and unit tests
- Phase 8: Bench Order + Chip Suggestions
- Phase 7: Transfer Optimization Engine
- Phase 6: Captain Modes (Conservative vs Aggressive)
- Phase 5: Stat Picker Engine Architecture
- Phase 3: League page with Selector Grid + Detail View

---

For questions or issues: https://github.com/EmptyCornmeal/fpl-assistant/issues
