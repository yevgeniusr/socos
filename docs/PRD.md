# SOCOS CRM — Product Requirements Document

**Version:** 0.2.0  
**Last Updated:** 2026-04-10  
**Stage:** MVP  

---

## 1. Overview

**What is SOCOS?**  
Gamified Personal CRM — track relationships, log interactions, earn XP, level up your social life.

**Target Users:**  
Solopreneurs and small sales teams managing 50–500 professional relationships.

**MVP Goal:**  
A logged-in user can add contacts, log interactions (call/message/meeting), see stats (XP, level), and have buttons that actually work.

---

## 2. User Stories (Gherkin Format)

### Auth

```gherkin
Feature: Authentication

  Scenario: New user registers with invite code
    Given I am on the login page
    When I click "Sign up"
    And I enter my name "Test User"
    And I enter email "test@example.com"
    And I enter password "TestPass123"
    And I enter a valid invite code
    And I click "Create Account"
    Then I am redirected to the dashboard
    And my name "Test User" appears in the sidebar

  Scenario: Existing user logs in
    Given I am on the login page
    When I enter email "yev.rachkovan@gmail.com"
    And I enter the synthetic password from `E2E_TEST_PASSWORD`
    And I click "Sign In"
    Then I am redirected to the dashboard
    And my token is stored in localStorage

  Scenario: User logs out
    Given I am logged in to the dashboard
    When I click "Sign Out"
    Then I am redirected to the login page
    And my token is removed from localStorage
```

### Contacts

```gherkin
Feature: Contact Management

  Scenario: User adds a new contact
    Given I am logged in to the dashboard
    When I click "Add Contact"
    Then the Add Contact modal opens
    When I fill in first name "Alice"
    And I fill in last name "Smith"
    And I fill in company "Acme Corp"
    And I click "Create Contact"
    Then the modal closes
    And "Alice Smith" appears in the contact list
    And I see a success toast "Contact Alice created!"

  Scenario: User searches contacts
    Given I have 3+ contacts in my list
    When I type "Alice" in the search box
    Then I only see contacts matching "Alice"
    And other contacts are hidden

  Scenario: User filters contacts by label
    Given I have contacts with label "Networking"
    When I click the filter "Networking"
    Then I only see contacts with label "Networking"

  Scenario: Contact shows quick action buttons on hover
    Given I am on the dashboard with contacts
    When I hover over a contact card
    Then I see Call, Message, and Reminder buttons
    And they are invisible until hover
```

### Interactions

```gherkin
Feature: Interaction Tracking

  Scenario: User logs a call via quick action button
    Given I am logged in with contacts
    When I hover over a contact card
    And I click the Call button
    Then an interaction of type "call" is created
    And I see a success toast "Call logged!"
    And my XP increases by 10
    And the interaction appears in the contact's timeline

  Scenario: User logs a message via quick action button
    Given I am logged in with contacts
    When I hover over a contact card
    And I click the Message button
    Then an interaction of type "message" is created
    And I see a success toast "Message logged!"

  Scenario: User sets a reminder via quick action button
    Given I am logged in with contacts
    When I hover over a contact card
    And I click the Reminder button
    Then a reminder is created for tomorrow
    And I see a success toast "Reminder created!"
    And the reminder appears in the sidebar reminder list
```

### Gamification

```gherkin
Feature: Gamification

  Scenario: User sees correct XP and level
    Given I am logged in
    Then I see my current XP in the stats card
    And I see my current level
    And I see XP progress bar with current/needed values

  Scenario: XP increases after logging interaction
    Given I have 50 XP and Level 1
    When I log a call interaction
    Then my XP increases by 10 (to 60)
    And the XP counter updates immediately
    And the XP progress bar updates

  Scenario: User sees contact count
    Given I have 6 contacts
    Then the stats card shows "Total Contacts: 6"
```

### Reminders

```gherkin
Feature: Reminders

  Scenario: Upcoming reminders appear in sidebar
    Given I have reminders scheduled
    Then the AI sidebar shows my upcoming reminders
    And they are sorted by nearest date first

  Scenario: Reminder shows days until due
    Given a reminder is due tomorrow
    Then it shows "Tomorrow" label
    When a reminder is due today
    Then it shows "Today" label
    When a reminder is due in 3 days
    Then it shows "3d" label
```

---

## 3. API Endpoints (Contract)

All endpoints require `Authorization: Bearer <token>` header unless noted.

| Method | Path | Auth | Description | Response |
|--------|------|------|-------------|----------|
| POST | `/api/auth/login` | No | Login | `{ accessToken, user }` |
| POST | `/api/auth/register` | No | Register | `{ accessToken, user }` |
| GET | `/api/contacts` | Yes | List contacts | `{ contacts: Contact[] }` |
| POST | `/api/contacts` | Yes | Create contact | `Contact` |
| GET | `/api/contacts/:id` | Yes | Get contact | `Contact` |
| PUT | `/api/contacts/:id` | Yes | Update contact | `Contact` |
| DELETE | `/api/contacts/:id` | Yes | Delete contact | `{ success: true }` |
| GET | `/api/interactions` | Yes | List interactions | `{ interactions: Interaction[] }` |
| POST | `/api/interactions` | Yes | Log interaction | `Interaction` |
| GET | `/api/reminders/upcoming` | Yes | List upcoming | `{ reminders: Reminder[] }` |
| POST | `/api/reminders` | Yes | Create reminder | `Reminder` |
| PUT | `/api/reminders/:id/complete` | Yes | Mark done | `Reminder` |
| GET | `/api/gamification/stats` | Yes | Get user stats | `{ user, stats }` |
| GET | `/api/health-check` | No | Health check | `{ status: "ok" }` |

### Response Shapes

```typescript
interface Contact {
  id: string;
  firstName: string;
  lastName: string | null;
  photo: string | null;
  company: string | null;
  jobTitle: string | null;
  labels: string[];
  lastContactedAt: string | null;  // ISO date
  relationshipScore: number;       // 0–100
  birthday: string | null;
  email: string | null;
  phone: string | null;
}

interface Interaction {
  id: string;
  contactId: string;
  type: 'call' | 'message' | 'meeting' | 'note';
  title: string;
  occurredAt: string;
  xpEarned: number;
}

interface Reminder {
  id: string;
  title: string;
  type: 'birthday' | 'followup' | 'meeting' | 'custom';
  scheduledAt: string;  // ISO datetime
  status: 'pending' | 'done';
  contact: { id: string; firstName: string; lastName: string | null };
}

interface User {
  id: string;
  name: string;
  email: string;
  xp: number;
  level: number;
}

interface Stats {
  totalContacts: number;
  totalInteractions: number;
  xpProgress: number;   // XP within current level
  xpNeeded: number;    // XP required for next level
  levelName: string;
}
```

---

## 4. Acceptance Criteria

### Must Pass (MVP Gate)

- [ ] Login with the synthetic `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` account -> dashboard
- [ ] Dashboard shows 6 seeded contacts (from DB seed)
- [ ] Stats show: total contacts count, XP, level
- [ ] Add Contact modal opens → creates contact → appears in list
- [ ] Quick action Call button → logs interaction → toast appears → XP increases
- [ ] Quick action Message button → logs interaction → toast appears
- [ ] Quick action Reminder button → creates reminder → appears in sidebar
- [ ] Search box filters contacts by name
- [ ] Sign out → returns to login page
- [ ] All API endpoints return correct HTTP status codes (not 404/500)

### Browser Test Checklist (Playwright)

1. Login flow → dashboard loads
2. Contact list renders with 6 contacts
3. Stats row shows non-zero values
4. Add Contact → form → submit → new contact in list
5. Hover contact card → 3 action buttons appear
6. Click Call → toast → XP counter updates
7. Click Reminder → reminder appears in sidebar
8. Search "Alice" → only Alice shows
9. Sign out → login screen

---

## 5. Tech Architecture

```
Browser → Next.js (port 3000) → proxy /api/* → NestJS (port 3001/api/*) → PostgreSQL
```

### Proxy Rule (Critical)
Next.js API catchall MUST proxy to `http://api:3001/api/<path>` (note `/api` prefix).
NestJS MUST have `app.setGlobalPrefix('api')`.

### Environment Variables

**NestJS (`services/api/.env`):**
```
DATABASE_URL=postgresql://...
JWT_SECRET=<secret>
PORT=3001
```

**Next.js (`apps/web/.env.production`):**
```
API_INTERNAL_URL=http://api:3001
NEXT_PUBLIC_BACKEND_URL=https://socos.rachkovan.com
NEXT_PUBLIC_SITE_URL=https://socos.rachkovan.com
```

---

## 6. Known Issues (to fix)

- [ ] API proxy double-prefix: `/api/contacts` → Next.js → `http://api:3001/contacts` but NestJS expects `/api/contacts` → 404
- [ ] Quick action buttons not working end-to-end (404 on API calls)
- [ ] No end-to-end test suite

---

*Owner: Nanachi (CEO) | Engineer: Hermes (CTO)*
