# SOCOS MVP Spec - Core User Flows

**Project:** SOCOS CRM
**Stage:** MVP
**Updated:** 2026-04-24
**Status:** ✅ Authenticated, ✅ Add Contact (fixed), ✅ Stats, ✅ Toast

---

## 1. Authentication

| Flow | Status | Notes |
|------|--------|-------|
| Landing page loads | ✅ | Title "SOCOS", tagline, CTA |
| Login form on /dashboard when unauthenticated | ✅ | Email + password inputs |
| Login with valid credentials | ✅ | Redirects to dashboard |
| Login with invalid credentials | ✅ | Shows error message |
| Token stored in localStorage | ✅ | Key: `socos_token` |
| Logout clears token | ✅ | Button in dashboard header |

**Test Creds:** Supply a synthetic account through `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD`.

---

## 2. Dashboard (Authenticated)

| Flow | Status | Notes |
|------|--------|-------|
| User profile loads | ✅ | Name, email, XP, level |
| XP progress bar renders | ✅ | Shows XP progress toward next level |
| Stats panel loads | ✅ | Total contacts, level, total XP |
| Contact list loads | ✅ | Paginated, searchable |
| Filter by label | ✅ | All, Networking, Friend, etc. |
| Search contacts | ✅ | Filters by name/company |

---

## 3. Add Contact Modal (🔴 BLOCKED - Bug)

**Requirement:** Modal opens → user fills form → submits → contact created → success toast → modal closes → contact appears in list

**Expected Behavior:**
1. Click "Add Contact" button → modal opens
2. Fill required fields (firstName required, lastName optional) → submit
3. API call: `POST /api/contacts` with JWT
4. On success: show success toast, close modal, add contact to list
5. On error: show error message in modal

**Actual Behavior:**
- Modal form does NOT have email/phone fields (only used in NewContactForm type but not rendered)
- The form sends optional email/phone as payload but they're not in the form UI
- Contact creation may work but UI incomplete

**Fix Applied (2026-04-24):**
- ✅ Added email input field to modal form (type=email, placeholder=john@example.com)
- ✅ Added phone input field to modal form (type=tel, placeholder=+1 234 567 8900)
- ✅ Payload now includes email and phone when provided

---

## 4. Stats Display (✅ VERIFIED)

**Stats shown in dashboard:**
| Stat | Source | Status |
|------|--------|--------|
| Total Contacts | `/api/gamification/stats` → `stats.totalContacts` | ✅ |
| Your Level | `/api/gamification/stats` → `user.level` | ✅ |
| Total XP | `/api/gamification/stats` → `user.xp` | ✅ |

**XP Progress bar:**
- `xpProgress` / `xpNeeded` from stats
- Level name from `stats.levelName`

---

## 5. Toast Notifications (✅ VERIFIED)

**Toast component:** `Toast` function at line ~557
- Auto-dismisses after 3000ms
- Types: `success` (green), `error` (red), `info` (blue)
- Position: fixed bottom-6 right-6
- Triggered by `setToast({ message, type })` in Dashboard

**Actions that trigger toasts:**
| Action | Toast Type | Status |
|--------|------------|--------|
| Contact created successfully | success | ✅ Triggered in `onSuccess` |
| API error | error | ❓ Not clearly triggered in current code |

**Issue:** Toast for errors is not clearly wired. The `AddContactModal` shows inline error but doesn't trigger dashboard toast.

---

## 6. Contact List

| Feature | Status | Notes |
|---------|--------|-------|
| Renders contacts from API | ✅ | Via `apiFetch('/api/contacts', token)` |
| Shows firstName, lastName, company | ✅ | |
| Shows labels/tags | ✅ | |
| Shows lastContactedAt | ✅ | |
| Shows relationshipScore | ✅ | |
| Empty state | ✅ | "No contacts yet" message |
| Search/filter | ✅ | Local filter by name |

---

## 7. Gamification Engine

| Feature | Status | Notes |
|---------|--------|-------|
| XP from interactions | ✅ | Earned via `interactions` module |
| Level progression | ✅ | `level` field on User |
| Achievements | ❓ | Not verified in UI |
| Streaks | ❓ | Not verified in UI |

---

## Open Questions / Technical Debt

1. **Add Contact modal missing email/phone fields** - confirm if these are MVP scope
2. **Toast for API errors** - should error toast appear in dashboard or inline?
3. **No e2e test coverage** for contact creation flow
4. **Celebrations (birthdays)** - need celebration spec
5. **Dungeon Master (RPG)** - DM module exists but not integrated in web UI

---

## Priority Fixes for Next Sprint

1. **HIGH:** Clarify Add Contact modal scope (which fields are MVP?)
2. **HIGH:** Wire error toast in Dashboard when API calls fail
3. **MEDIUM:** Write e2e test for Add Contact flow
4. **MEDIUM:** Verify celebrations/birthdays display correctly
5. **LOW:** Add contact detail page (/contacts/:id)
