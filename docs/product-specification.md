# Mise — Product Requirements Specification

**Version:** 2.1 (controlled amendment to frozen requirements baseline)  
**Date:** 27 October 2026  
**Status:** **Frozen baseline for implementation** — P0/P1 scope and owner decisions approved. Future changes require an explicit change request; milestone-specific technical validation remains open.  
**Product:** Mise  
**Intended repository location:** `docs/product-specification.md`

## 1. Executive summary

Mise is a **private, mobile-friendly household application** for collecting, maintaining and evaluating recipes; planning nutritionally appropriate meals; coordinating household schedules; and managing grocery shopping. The application includes separate conversational AI workflows for **meal planning** and **recipe import**, while Mise itself owns the persistent records and validates all changes.

The initial household consists of two adults with separate accounts and a shared recipe bank, meal plans and shopping lists. Each household member also has an **individual profile**, dietary preferences and goals, and a recurring exercise schedule. The planning assistant should reconcile different individual objectives—such as weight management and exercise needs—while recommending the **same dishes when both eat together**, with **member-specific practical portion sizes**, plan-specific recipe scaling and, when necessary, simple individual additions or adjustments.

Mise should account for planned office lunches, recurring activities, absences, meals away from home, food already available and week-specific changes. Both household members can use the service through a responsive web interface over securely configured HTTPS; the initial interface labels may be in English while recipes and AI conversations are in Finnish; neither requires a ChatGPT subscription. AI APIs are accessed only by the application backend. **OpenAI is the first implemented provider**, while the design permits additional providers without changing core domain logic or stored household data.

## 2. Goals, outcomes and boundaries

| ID | Product goal / success measure |
|---|---|
| G1 | Import recipes from public web URLs, images or pasted text into editable, reviewable drafts, and save them without manual retyping. |
| G2 | Generate and edit practical weekly meal plans across all daily meal slots, taking into account recipes, preferences, nutrition goals, activities, schedules and leftovers. |
| G3 | Recommend **individual portions** of shared dishes, taking account of each member's stated dietary goals and relevant profile information. |
| G4 | Record what was cooked, tested, liked or changed, and use that history when planning future meals. |
| G5 | Suggest new recipes when useful; favor an existing recipe when the user requests a specific dish and a suitable match exists. Add AI-suggested new recipes to the bank **only after user approval and review**. |
| G6 | Maintain collaborative, independently usable shopping lists containing both meal-plan ingredients and arbitrary household items, with category grouping and pickup checkboxes. |
| G7 | Let both household members work with shared information from desktop and mobile, without a ChatGPT account. |
| G8 | Keep hosting, administration and AI usage costs suitable for a private self-hosted family application. |

### 2.1 Non-goals for the initial release

- Public recipe community, marketplace, third-party grocery ordering or real-time grocery prices.
- Clinical nutrition advice, medical diet treatment, exact metabolic measurement or medically precise calorie tracking. **Practical calorie and portion guidance for stated lifestyle goals is in scope.**
- Automatic extraction from login-protected or paywalled websites, or bypassing access restrictions.
- Native mobile apps, voice-first interaction, offline AI inference or image generation.
- A separately deployed MCP server; a future MCP adapter may be added without changing the core domain model.
- Automatic synchronization with external exercise calendars, wearables or office calendars in the MVP; structured schedules and chat-based changes suffice.

## 3. Users and core scenarios

| User | Needs and permissions |
|---|---|
| Household member | Manage personal dietary/activity profile; browse and edit shared recipes; record personal feedback; plan meals; use shared shopping lists. |
| Household administrator | Manage household accounts, configuration, external API credentials, data export, backup and restore. |

### 3.1 Key user journeys

1. **Import a recipe:** enter a public URL, image or text → extract → identify gaps and uncertainties → review/edit draft → explicitly save → recipe is searchable.
2. **Plan a week:** select a week → load both profiles, recurring schedules and known absences → describe exceptions in chat → AI proposes meals and member-specific portions → review and approve structured plan.
3. **Request a dish:** ask for a particular meal → prioritize an appropriate saved recipe → if none matches, AI may propose a new one → review and explicitly approve adding it to the bank.
4. **Record feedback:** identify a recipe → mark cooked/tested, add personal rating/notes → optionally approve a change to the shared canonical recipe → preserve history.
5. **Shop:** create a shopping list independently or select an existing one → add approved plan requirements → append miscellaneous items → mark items picked up on mobile → both members see updates.
6. **Coordinate schedules:** each member maintains recurring office lunches, exercise and other activities → week-specific additions/cancellations are entered via UI or chat → meal plan considers who will eat each meal at home.

## 4. Product scope and priorities

**Priority definitions:** P0 = necessary for MVP; P1 = explicitly deferred until after the MVP (not included in MVP acceptance); P2 = later opportunity. Priority does not imply implementation order.

| Area | MVP / P0 | Deferred P1/P2 |
|---|---|---|
| Recipe bank | Shared CRUD; title and full-text content search; tags/filters; serving and ingredient data; revisions; provenance | Advanced taxonomy |
| Import | URL, text and image; review and approval; provenance | Conversational editing of import drafts; batch import and merge |
| Profiles / nutrition | Individual profiles, goals and relevant activity data; practical estimated portions/calories | More sophisticated nutritional analysis, history/analytics |
| Schedules | Recurring activity/office patterns and plan-week exceptions | Calendar integration and scheduling automation |
| Meal planner | AI chat; five daily meal slots; member participation; shared dishes with different portions; weekly plan editing | More advanced optimization and meal-plan analytics |
| Cooking feedback | Cooking events, tested status, ratings, notes, confirmed canonical edits | Enhanced recipe-page assistant, reporting |
| Shopping | Multiple independent lists; categorization; freeform items; add plan items to selected list; live checkbox state | Pantry inventory, store-specific categories and automatic stock subtraction |
| Household | Two individual logins; shared household data; secure internet access | More elaborate household invitation and role management |
| Operations | Docker deployment, backup/restore, API usage visibility and secure reverse-proxy deployment | Advanced metrics and integrations |

All P1/P2 items in the right column are **out of MVP scope**. Their presence records future ideas only; it does not expand the Definition of Done in §14.

## 5. Functional requirements

### 5.1 Recipe bank

- **FR-01 [P0]** Create, read, update and archive recipes. Store title, yield/servings, structured ingredient lines, ordered steps, optional preparation/cooking times, tags, notes and source metadata.
- **FR-02 [P0]** Search recipes **by name using free-text matching**; filter by tags, tested status, rating and effort/time where such metadata exists. Present usable mobile views.
- **FR-03 [P0]** Preserve immutable recipe versions on changes to cooking-related canonical content (ingredients, instructions and source yield). Mutable metadata such as tags, general notes and archive status does not itself create a cooking revision. Show author, time, change reason and prior versions; support restoring an earlier version.
- **FR-04 [P0]** Preserve individual cooking events, tested status, ratings (optional 1–5) and notes independently from the shared canonical recipe. Both members may edit the recipe: the **latest approved revision is the one shared household version**, with history available; there are no competing per-person canonical versions.
- **FR-05 [P0]** Preserve imported or entered ingredient quantities and units verbatim, including Finnish units (`kpl`, `rkl`, `tl`, `dl`, `prk`, `ps`), ranges, ingredient groups, fractions, preparation notes and ambiguous values such as `maun mukaan`. Scaling and shopping normalization must not invent package sizes or silently convert incompatible units. Maintain household staple preferences for excluding common pantry items from generated shopping additions, with an explicit skipped-items review (not a pantry inventory).
- **FR-06 [P0]** On any recipe page, provide a **servings converter** that proportionally scales ingredient quantities for an entered target yield/servings **without saving a canonical edit**. Scaling must preserve ingredient units, show sensible quantities/rounding and avoid falsely precise conversions for vague amounts (e.g. “to taste”). The user may reset to the canonical yield.
- **FR-06A [P0]** When adding a saved recipe to a meal-plan slot, retain the selected **recipe ID, recipe-version reference or snapshot, canonical base yield and plan-specific target yield/scaling factor**. The weekly calendar opens the recipe **already scaled to that meal's saved yield**, including when opened on the actual cooking day or from another household account. The user can override scaling **for that planned occurrence**, without altering the canonical recipe or other meal slots.
- **FR-06B [P0]** Planned recipe quantities and planned **member-specific portion recommendations** must be consistent. The planner should propose a practical total cooking yield based on participants' portions and optionally planned leftovers. For shopping lists, use the explicitly approved planned yield—not an unrelated recipe-page preview scaling. Preserve the link between portions, planned yield and shopping requirements, and flag meaningful mismatches for review.
- **FR-07 [P0]** Support full-text search over ingredient names, directions and notes, e.g. searching `carrot` finds recipes mentioning carrot anywhere in searchable recipe content.

### 5.2 Recipe importer and new recipe suggestions

- **FR-10 [P0]** Accept a public recipe URL, pasted text, photograph or screenshot, and show the origin and extraction status.
- **FR-11 [P0]** For URLs, prefer available schema.org `Recipe`/JSON-LD and fall back to extracting readable page content, subject to safe fetching and site restrictions.
- **FR-12 [P0]** Use image-capable AI for photos and structured extraction schemas to normalize all accepted input types.
- **FR-13 [P0]** Extract to an editable draft; visibly flag missing, ambiguous, conflicting or inferred content. Never silently fabricate quantities.
- **FR-14 [P0]** Save only with explicit approval; retain agreed provenance (source URL, original text or optional image reference, import date), and detect potential duplicates before save.
- **FR-15 [P1]** Conversationally refine an importer draft before saving, including re-extraction or correction.
- **FR-16 [P0]** The planner may propose a recipe not in the database. If the household member wants to keep it, convert it into a reviewable recipe draft and save **only on explicit confirmation**. The planner must not silently add proposed dishes to the recipe bank.

### 5.3 User profile, diet goals and activity schedules

- **FR-17 [P0]** Each member may maintain a **household-visible personal nutrition profile** containing relevant details such as age, body weight, optional height, typical activity/exercise, dietary restrictions, dislikes and a stated objective (for example weight loss, maintenance or another self-defined goal). No medical diagnosis is required.
- **FR-18 [P0]** Maintain **individual goals and planning preferences** independently. Allow household-wide preferences separately. Profile details must be editable without modifying source code.
- **FR-19 [P0]** Each member may **optionally** define recurring exercise and availability patterns (e.g. badminton Tuesday, office lunch Wednesday–Friday) and exceptions for a selected week. If no applicable recurring schedule is stored **and the user has not supplied the needed information for that planning week**, the planner chat should ask about exercise, office days and meal absences before completing the plan. Do not silently assume there are no activities or office lunches. Chat may propose changes to week-specific schedule data; persistent recurring schedule changes require an explicit instruction and confirmation.
- **FR-19A [P0]** Derive individual daily energy targets deterministically from documented estimation methods and conservative safeguards; estimate recipe energy with provenance when adequate data exist, and support manual overrides. Use profiles and stated goals to provide **approximate, clearly labeled** calorie/portion guidance for individual meal slots and members; do not represent estimates as precise nutrient measurements. **For meal-planning recommendations and simple accompaniments that do not require a saved recipe**, use pragmatic everyday measures (e.g. `10 cherry tomatoes`, `5 cm cucumber`, `2 slices of bread`) instead of forcing the user to weigh everything. **Saved recipes retain the ingredient quantities and units from their source** (e.g. `5 tomatoes` or `500 g tomatoes`); serving conversion scales quantities in those existing units rather than converting them into everyday measures. Show grams/ml when the original recipe uses them or when needed for preparation or nutritional context. Allow goals and portions to be overridden.
- **FR-19B [P0]** Track whether each member expects to eat a given planned meal at home, elsewhere or not at all. For away meals, offer a configurable default estimated energy amount and optional member correction; no food diary is required. A shared dish is preferred **when both participate**, but meal participation and portion sizes may differ. No household member is required to consume every planned slot.

### 5.4 Meal planning and AI chat

- **FR-20 [P0]** Provide a dedicated meal-planning chat with persistent, revisitable threads, distinct from recipe import.
- **FR-21 [P0]** Retrieve recipes, cooking history, household/personal preferences, goals, recurring schedules, member-specific activity details and current/recent plans using authorized backend tools.
- **FR-22 [P0]** Produce an editable plan for **any seven-day period**, supporting partial weeks and optional partial-day planning (e.g. dinners only), with these default daily slots in order: **breakfast, lunch, snack, dinner, evening snack**. Allow reusable usual breakfast/snack defaults without forcing users to review 35 slots each week.
- **FR-23 [P0]** Incorporate office lunches, exercise, evening events, meal absences, cooking-time limits, leftovers, perishable ingredients and other week-specific constraints supplied through UI or chat. Distinguish a one-off exception from a permanent preference.
- **FR-24 [P0]** Display the plan as structured editable data with draft → approved → archived lifecycle. Approved recipe components stay pinned to their approved revision until an explicit user update; when the household recipe is revised, notify and offer an explicit refresh (including shopping reconciliation), never apply it automatically. Track leftovers by source meal occurrence. A planned meal may combine a saved recipe with simple accompanying foods (such as lettuce, cucumber or tomatoes) that have no recipe entry; their planned quantities must be retained and editable. Include **per-member meal participation, recommended portions, plan-specific target recipe yield and a recipe link that opens the saved planned scaling**. AI proposals are previewed or explicitly requested before being committed; changing one slot does not overwrite unrelated slots.
- **FR-25 [P0]** Produce a shopping-list addition from an approved plan, accounting for **saved per-occurrence recipe scaling**, quantities of recipe-free accompaniments, serving quantities, planned participants and intended leftovers. If one or more shopping lists already exist, **ask which existing list should receive the plan items or whether to create a new list**. Do not overwrite unrelated list content.
- **FR-26 [P0]** Provide editable household and member-specific diet/food preferences, restrictions, effort limits and portion-related guidance outside chat (previously P1; promoted to P0 because individual nutritional goals depend on it).
- **FR-27 [P1]** Provide contextual assistant actions on an individual recipe page for recording feedback and preparing edits (general feedback and confirmed edits remain supported in MVP).
- **FR-28 [P0]** When a user explicitly asks for a particular dish, prefer a suitable matching **saved** recipe. When the request is exploratory, recommend from existing recipes and optionally suggest suitable new ones, clearly distinguishing unsaved suggestions.
- **FR-29 [P0]** Planner recommendations should state the assumptions behind estimated calories and portion sizes when relevant, and should not enforce restrictive intake targets or silently adjust someone's stated goal.

### 5.5 Shopping lists

- **FR-34 [P0]** Create, name, view, edit, archive and manage **multiple shopping lists independently of meal planning**.
- **FR-35 [P0]** Add arbitrary items including **non-food household goods**, with optional quantities, units and notes.
- **FR-36 [P0]** Categorize and group visible shopping-list items using editable category defaults and persisted member/household corrections by normalized ingredient key, with an `Other` fallback; group by product type (e.g. vegetables, fruit, dairy, meat, dry goods, household supplies).
- **FR-37 [P0]** Mark each item **picked up / not picked up** directly in the responsive shopping-list UI. **When either member changes the state, the other member’s already-open shopping-list view updates automatically, without a manual refresh** (including when both shop simultaneously). Handle short disconnections, reconnect synchronization, and duplicate/out-of-order updates; show the authoritative server state.
- **FR-38 [P0]** When an approved plan is added to a shopping list, combine compatible **software-generated ingredient contributions within that plan import** by identical normalized ingredient key and compatible units, while preserving all source contributions. User-created rows never merge automatically with generated rows. Different plan imports remain separate by default; reconciliation of an existing plan import is not a new import. Similar rows may be flagged and explicitly merged. Never silently modify checked-off or user-modified items; present plan changes as a reviewable reconciliation. Exclude household-marked staples from generated rows and show them in an expandable skipped-staples review.
- **FR-39 [P0]** The shopping-list UI remains usable without an AI API call; users can create and use standalone lists with manual items even before making a meal plan.

### 5.6 Shared use and administration

- **FR-30 [P0]** Maintain separate authenticated accounts for two household members, both authorized to see and edit shared recipes, meal plans and shopping lists.
- **FR-31 [P0]** Record attribution for cooking events and recipe changes; apply authentication and server-side household authorization to all access.
- **FR-32 [P0]** Support documented portable data export (at least recipes as JSON and Markdown, plus structured exports of plans, profiles/preferences, schedules, history and lists as appropriate) and a tested restore process.
- **FR-33 [P1]** Provide enhanced activity/history displays, account-specific favorites and conflict warnings beyond basic versioning and attribution.

## 6. AI behavior and controls

Mise uses **backend-mediated AI provider APIs**, initially OpenAI, not a shared ChatGPT Project or a published Apps SDK app. Domain workflows use a common application-owned AI contract rather than provider-specific SDK payloads. Keep the importer and planner as separate AI workflows with distinct prompts, conversation scopes and limited tool sets. Domain services perform authorization, validation and database changes.

| Workflow | Reads / operations | Persistence safeguards |
|---|---|---|
| Recipe importer | Read URL/text/image input, extract recipe draft, validate provenance and uncertainty | User reviews and confirms before canonical save |
| Meal planner | Read shared recipe bank, profiles, goals, activity/availability schedules, history and plans; propose meals and individualized portions | Write approved plans or explicitly requested modifications; avoid unrequested changes to other slots |
| Recipe feedback | Retrieve current recipe and history, register cooking feedback and propose ingredient changes | Record feedback on explicit command; require clear approval for canonical edits |
| Recipe suggestion | Suggest dishes beyond stored bank when appropriate; prepare draft for an approved new recipe | Never turn an unsaved suggestion into a canonical recipe without confirmation |

AI chat and user-facing recipe content should be in **Finnish by default**, while the first-release interface chrome may be in English. Keep UI labels/messages in extractable translation keys from the beginning, so actual multilingual UI support can be added in P1 without rewriting screens.

AI context sources: version-controlled workflow instructions; stored member/household data; relevant conversation messages or summaries; version-controlled house rules and reference guidance; user-uploaded AI guideline documents and provider file search are deferred beyond P0. There is **no automatic access to ChatGPT Project files or ChatGPT Memory**.

Nutritional reasoning should be explainable and proportionate: derive portion recommendations from user-provided data and recipe information, mark missing nutritional values as estimates and request clarification rather than assuming a medical condition or extreme target. Users can override any suggestion. Maintain a **single dish with individual portions** wherever practical rather than preparing separate dinners by default.

Treat remote pages, imported images and any future uploaded material as untrusted data, not executable instructions. Use typed function inputs and structured responses. Log operational failures, apply usage limits and retain drafts safely across failed requests.

## 7. Proposed domain model

| Entity | Responsibility / illustrative fields |
|---|---|
| Household / User | Membership, role and member identification. |
| MemberProfile | Birth year or age, optional height/weight and activity descriptors, individually editable goals/restrictions; avoid unnecessary sensitive data. |
| DietGoal / Preference | Personal and household scope, objective, constraints, effective date, source and updates. |
| RecurringScheduleEntry | Member, activity/office/absence type, day/time, recurrence and effective dates. |
| ScheduleException | Member, date or date range, override or additional event, meal participation impact. |
| Recipe | Stable ID, name, status, canonical current version and provenance. |
| RecipeVersion | Immutable cooking-content snapshot (ingredients, steps, yield), schema version, author, timestamp and reason; tags, general notes and archive state are mutable recipe metadata. |
| IngredientLine | Source amount/unit, numeric range if parseable, group, stable identifier, normalized key, scale policy, preparation and optional nutrition reference. |
| CookingEvent | Member, date, recipe/version, tested flag, optional 1–5 rating and comments. |
| ImportDraft | Source, extracted structured content, ambiguity warnings, optional asset reference and review state. |
| MealPlan / MealSlot | Household, local calendar dates, slot type, lifecycle, participation; a slot contains one or more meal components, not a recipe version/yield itself, and carries no leftover pointer (leftovers link at component level). |
| MealComponent / ComponentMemberPortion | Each recipe component pins a recipe version, original/target yield at approval; each simple side has its own quantity; member-specific quantities attach to each component; an optional leftover-source link on a component identifies the earlier component whose leftovers it consumes. |
| MealParticipant | Meal slot, member, home/away/not-eating status and optional away-energy estimate or correction; per-component portion guidance lives on ComponentMemberPortion. |
| ShoppingList | Household, title, lifecycle/status, timestamps and list-level synchronization sequence (not a write-conflict token). |
| ShoppingItem / ShoppingItemSource | List ID, origin, label, category, quantity/unit, picked-up status, item revision, and many optional sources per generated row. Generated contributions from the same plan batch may consolidate, with source links; cross-batch and user rows remain separate unless explicitly merged. |
| Conversation / Message | Household/thread owner, workflow, messages, context summary and timestamps. |

Design rules: **recipe-page scaling is ephemeral**, whereas **meal-plan scaling is persistent for that specific occurrence**; a canonical recipe edit should not silently change the saved cooking instructions or quantities of an already approved weekly meal (use its version/snapshot); rebase is a deliberate user action. Changes to a planned yield should indicate when an already-generated shopping list may be stale and offer a reviewable adjustment, not silently add duplicates. One shared **canonical recipe** at a time; immutable recipe versions; user-attributed cooking history; explicit member-specific portions; shared shopping-list state; stable identifiers; UTC instants plus correct local-date handling for weekly plans. Treat personal profile and wellness information as sensitive household data and limit its retention and AI transmission to what is needed.

## 8. Proposed architecture and deployment

**Recommendation:** one private Git repository, one modular-monolith application, one relational database, and a responsive web UI. A React/TypeScript frontend, TypeScript backend and PostgreSQL fit the intended homelab, but framework selection is an implementation decision.

```text
Browser / mobile web
        |
 HTTPS reverse proxy (e.g. nginx)
        |
  Mise application
   |-- Auth / household authorization
   |-- Recipes / versions / reviews
   |-- Profiles / diet goals / schedules
   |-- Meal plans / member portions
   |-- Shopping lists / live updates
   |-- Recipe importer
   |-- Planner AI orchestration
   |
   +-- PostgreSQL
   +-- Private attachment storage
   +-- Provider-neutral AI gateway (outbound HTTPS only)
        +-- OpenAI adapter (implemented first)
        +-- Other provider adapters (future)
```

Use consistent server-side domain services for human UI and AI tools. The web application and any future MCP adapter call the same services. Do not expose the PostgreSQL port or any AI-provider credentials on the public internet.

## 9. Non-functional requirements

- **NFR-01 [P0] Internet-facing security:** Support public HTTPS access **without VPN** through an nginx-compatible reverse proxy. Use self-hosted Authelia via OIDC for identity, retaining **two permitted authentication options**: (a) passwordless FIDO2/WebAuthn passkey with user verification, or (b) password plus mandatory TOTP second factor. Either option must meet the agreed security assurance level; validate actual Authelia policy and version support before enabling passwordless access, rather than relying on experimental behavior. Map authenticated subjects only to provisioned household members. Mise maintains secure **long-lived, individually revocable device sessions**, with both sliding and absolute expiry, `Secure`/`HttpOnly`/appropriately `SameSite` cookies, CSRF protections, and immediate revocation across API and live connections. **New Mise device sessions require verified fresh authentication through Authelia**, not silent reuse of an existing identity-provider SSO session; request and validate an appropriate OIDC freshness constraint (`max_age=0` and `auth_time`, or a verified equivalent), compatible with the deployed passkey and password + TOTP flows. Provide a tested lost-device recovery procedure covering both Mise sessions and relevant Authelia sessions/credentials. Enforce authorization on every protected API and asset route. Provide rate limiting, hardened headers/CSP, restricted service ports/egress and a tested recovery procedure; do not implement standalone password login in P0. Public exposure requires a threat-model review.
- **NFR-02 [P0] URL fetching safety:** Defend against SSRF, including redirects, DNS rebinding and private/loopback/link-local destinations; restrict schemes and content types, enforce fetch time/size limits and sanitize untrusted page data.
- **NFR-03 [P0] Privacy:** Both household members may view one another’s full profiles, including weight and goals, as explicitly agreed; no additional per-member profile privacy controls are required in P0. Collect only necessary profile/goal/activity information; supply primarily derived targets and restrictions rather than raw age/weight to the AI; display what may be transmitted to the configured external AI provider; keep API credentials server-side; define retention/deletion/export of personal information; use the provider's supported retention/privacy settings.
- **NFR-04 [P0] Reliability:** Back up PostgreSQL plus source attachments, test restore, use transactions for multi-record changes and idempotency against duplicated writes/retries.
- **NFR-05 [P0] Usability and language:** Mobile-first responsive presentation, accessible checkbox controls and compact shopping UI for use in stores; non-chat CRUD remains available independently of AI. **UI labels may initially be English; default recipe content and AI conversations are Finnish.** Externalize UI strings/formatting assumptions for eventual translation; **shipping additional UI languages is P1**, not P0.
- **NFR-06 [P0] Performance:** Core recipe and shopping-list operations do not depend on AI availability; long AI operations show visible states and recoverable errors.
- **NFR-07 [P0] Cost controls:** Track AI use by provider, model and workflow, provide configurable budgets/request limits and prefer structured page extraction before model processing. Exact budget to be agreed.
- **NFR-08 [P0] Observability:** Healthchecks and structured, minimally sensitive logs; do not log full user profiles, recipe photos or chat content by default.
- **NFR-09 [P0] Concurrency and live collaboration:** Online synchronization is required in MVP; offline mutation queues are explicitly P1. Prevent silent loss of edits when both household members update the same recipe or shopping list; use version checks and/or clear conflict handling. Propagate shopping-item checked/unchecked changes to other active clients automatically via a lightweight realtime mechanism (e.g. SSE or WebSocket), with initial state fetch, reconnection resync and a usable fallback. Do not require page reload or AI calls.

**Security note:** This is a security baseline, not a claim of security certification. Before internet exposure, complete a dedicated threat-model/checklist review and keep runtime dependencies patched.
- **NFR-10 [P0] AI provider independence:** AI workflows must depend on a Mise-owned provider-neutral interface for text/conversation, structured extraction, image understanding and tool invocation. OpenAI is the only required provider implementation in P0; Anthropic, Google and other providers are future options. Keep prompts/tool permissions, validation, approvals, durable conversations and business data in Mise. Persist provider/model identifiers and normalize usage/errors; capabilities must be checked before selecting a model for a workflow. Provider selection may be configured per workflow on the server; no end-user model switcher, automatic provider failover or second adapter is required in P0. Provider changes require Finnish regression tests and review of privacy, retention and pricing.

## 10. Acceptance criteria — MVP end-to-end

| ID | Scenario / pass condition |
|---|---|
| AC-01 | Import a public recipe URL, photo or text, inspect an editable draft and save it explicitly with provenance; a rejected draft does not create a recipe. |
| AC-02 | Search by recipe name, open/edit the shared canonical recipe and inspect its retained earlier versions. |
| AC-03 | After approving a change from 400 g to 200 g carrot, the current household recipe shows 200 g and the earlier 400 g version remains accessible to either member. |
| AC-04 | Each member enters different dietary objectives and recurring exercise schedules; the planner proposes the **same dinner** to both when both eat at home, but shows appropriately different **estimated, pragmatic portions** (e.g. cherry tomatoes by count, cucumber by length) and the assumptions used. |
| AC-05 | A week with an office lunch for one member and an evening absence for the other does not incorrectly assign both to every meal. A one-off change does not overwrite the normal recurring schedule. |
| AC-06 | A seven-day plan displays breakfast, lunch, snack, dinner and evening snack slots and allows editing one without changing unrelated meals. |
| AC-07 | Asking for a specified dish retrieves a suitable saved recipe when available. A novel AI-suggested dish is not added to the bank until reviewed and approved. |
| AC-08 | Create a standalone shopping list with groceries and a non-food item; group items by category; with both members viewing the list simultaneously, checking off milk on one device updates the second **without manual refresh**, including after reconnection. |
| AC-09 | With two existing shopping lists, adding plan ingredients prompts selection of an existing list or creation of a new one; the two recipes’ compatible generated onion contributions become one traceable generated row while a manually added onion row stays separate; existing unrelated items and picked-up states remain intact. |
| AC-10 | With no AI API access, authenticated members can still browse/edit existing recipes and manage shopping lists. |
| AC-11 | Rejected logins and direct unauthenticated API requests cannot access household data through a publicly reachable HTTPS reverse proxy. Revoking a device immediately invalidates its Mise API access and active SSE connection. A revoked device cannot silently obtain a new Mise session by reusing a still-valid Authelia SSO session: a fresh credential/user-verification challenge is required and verified. Test both enabled authentication methods and lost-device recovery. |
| AC-12 | Backup and restore recover shared recipes, profiles, schedules, meal plans, cooking events, shopping lists and stored attachments. |
| AC-13 | A failed import or interrupted AI request does not partially overwrite canonical recipes or create duplicate cooking events. |
| AC-14 | A recipe with canonical yield 4 can be preview-scaled to 3 servings from its recipe page without persisting a recipe edit. |
| AC-15 | A week-plan dinner saves a target yield of 3 servings; opening it from that week’s calendar on cooking day displays the ingredient amounts for 3 servings, independently of the canonical 4-serving recipe; changing the planned yield updates that occurrence, not the canonical recipe. |
| AC-16 | A revised planned serving count leads to a reviewable shopping-list adjustment, without silently duplicating or replacing already picked-up items. |
| AC-17 | With missing recurring schedules and no week-specific information, the planner asks about office lunches, exercise and absences before finalizing the plan; answered exceptions do not become recurring without confirmation. |
| AC-18 | The app supports Finnish recipe names and Finnish chat and recipe text, while English-only UI controls remain acceptable in MVP. UI copy is structured to support translation later. |

## 11. Incremental P0 delivery sequence

P0 denotes the entire agreed MVP scope, **not** a requirement to withhold all functionality until everything is built. Each milestone is a deployable, household-usable increment with a clear exit test.

| Milestone | Scope / exit criterion |
|---|---|
| **A — Daily foundations** | Authelia OIDC with validated passkey or password + TOTP authentication and revocable sessions; shared recipes, versioning, search and ephemeral servings scaling; standalone shared live shopping lists; working backup/restore. Both members can sign in, search recipes and shop concurrently. |
| **B — Recipe import and feedback** | URL/text/image importer with explicit review; source provenance; cooking events and individual ratings. |
| **C — Manual weekly planning** | Profiles, nutrition estimates and safeguards, recurring/exception schedules, manual calendar, planned components/portions/leftovers and recipe pinning on approval. |
| **D — AI planning and shopping generation** | Finnish chat planning, suggested-new-recipe review, staged proposals, approved plan-to-list consolidation and reconciliation with source tracking. |

**All four milestones collectively define P0/MVP**. P1 functionality (offline shopping writes, contextual recipe chat, conversational importer editing, full pantry tracking and translated UI languages) remains outside this definition.

## 12. Confirmed product decisions and implementation details

### 12.1 Confirmed by product owner

- Product name: **Mise**.
- Initial audience: two members of a private household, separate logins and shared canonical recipes.
- Meal plan defaults to five slots: **breakfast, lunch, snack, dinner, evening snack**.
- Both may edit recipes; there is **one household version** with revision history, not separate competing individual copies.
- Ratings: optional **1–5**; recording cooking can mark a recipe tested.
- Plan horizon: any seven-day window, including partial-week planning.
- Shopping lists are **MVP functionality**, not a later add-on.
- Keep provenance for imports; require confirmation before permanent recipe edits.
- Private Docker/homelab deployment with secure external HTTPS access.
- AI context includes application preferences and version-controlled house rules; uploading AI guideline documents is not part of P0.
- AI cost controls are required; exact limits are still to be selected.
- Markdown is the canonical source format for product documentation.
- **FR-06, FR-06A, FR-06B and FR-07 are P0; FR-15, FR-27, FR-33 and UI-i18n remain P1.**
- Planned recipe yield/scale is persisted per meal occurrence; ordinary recipe-page scale previews are not canonical edits.
- Nutrition coaching includes practical everyday portion units.
- Active shopping lists synchronize checkoff state automatically between both devices; plan-generated compatible entries from one import are **combined with source traceability**; manual rows and separate imports are not automatically merged.
- Initial UI may be English; recipe content and AI conversation default to Finnish; translation-ready UI architecture now, multilingual UI in P1.

### 12.2 Decisions confirmed in the second review

1. **Calories/portions:** Begin with user-configurable goals and approximate, explainable guidance; avoid implying clinical accuracy. Recommend easy-to-measure portions.
2. **Meal participation:** Record office lunches as `away` (optional free-text description). Assume shared eating only for meal slots where both members participate.
3. **Schedules:** Allow recurring office and exercise schedules for either member. If absent and no one-off information is supplied for the planned week, **the planner asks**, rather than guessing. Never overwrite recurring patterns with temporary changes.
4. **Shopping generation:** Combine same-plan generated contributions by normalized ingredient key and compatible units, preserving source links. Never automatically merge a user-added item with generated content or merge separate plan imports. Show similar-row warnings and preserve user modifications and already-picked rows during reconciliation.
5. **Nutrition estimation:** Deterministic, safeguarded daily target calculation; documented ingredient-based or manual recipe energy estimates with provenance and missing-data handling. Use a hybrid nutrition engine with Fineli as the preferred primary reference dataset, subject to validation of data coverage, licence/attribution and import format before integration. Match ingredients automatically on a best-effort basis, flag uncertainty and allow optional correction without making confirmation mandatory. Do not invent unsupported nutrient precision.
6. **Language:** Finnish for chats and recipe content by default; English UI acceptable in MVP; translation infrastructure in P0, shipping translated UI in P1.

### 12.3 Technical design decisions to resolve during implementation (not open product-scope questions)

- **Version handling in planned meals (confirmed):** Pin recipe version and yield at approval; if canonical content changes, notify and offer deliberate refresh. Do not silently change approved plans.
- **Live shopping technology:** SSE notifications plus REST snapshot/refetch and reconnection are the preferred P0 design; offline writes remain P1.
- **Nutritional calculations (ADR-007 approved):** Hybrid engine: deterministic code-based energy targets with conservative bounds, Fineli as the preferred reference, recipe-version energy estimates with coverage/assumptions/provenance, and automatic best-effort ingredient matching with optional corrections. Select and test the exact published estimation formula, safeguards, data import, mapping and treatment of unknown quantities/ranges during engineering design; these are implementation validation tasks, not unresolved product scope.
- **AI budget and technology validation:** Drizzle ORM + Drizzle Kit are selected with PostgreSQL (ADR-002), and Finnish PostgreSQL full-text search with `pg_trgm` and English-compatible search is selected (ADR-010). Validate advanced indexes/migrations and Finnish search quality with short technical spikes. Finalize the AI budget before enabling the AI features; authentication architecture is confirmed as Authelia OIDC with both passkey-based passwordless and password + TOTP options retained; exact enabled methods depend on validation of secure Authelia configuration. Revocable device sessions remain mandatory.


### 12.4 Approved architectural directions (27 October 2026)

These decisions inform implementation of the approved P0 requirements, **without adding new scope**:

1. **ADR-002 — Persistence:** PostgreSQL + **Drizzle ORM + Drizzle Kit**. Advanced indexes, migrations, transactions and schema drift will be verified in an implementation spike; explicit SQL migrations remain available for PostgreSQL-specific capabilities.
2. **ADR-007 — Hybrid nutrition engine:** Compute energy targets deterministically using a published method and conservative safeguards; use **Fineli as the preferred reference dataset**, subject to data/licensing/attribution verification; derive recipe energy from ingredients where possible, cache by immutable recipe revision with method/provenance/coverage and permit manual overrides. Ingredient-to-reference matching is **automatic and best-effort**, with uncertainty visible and user corrections optional. Lack of reliable data must not block normal recipe import or require a mandatory nutrition-review screen. Practical portion recommendations remain approximate, with no mandatory food diary or comprehensive micronutrient optimization.
3. **ADR-008 — Provider-neutral AI:** Domain AI workflows use an application-owned interface; OpenAI is the sole initial adapter. Configure provider/model per workflow, normalize persisted messages, costs and errors, and validate provider capability and privacy before additional adapters are enabled. No multi-provider execution or automatic failover in P0.
4. **ADR-010 — Search:** PostgreSQL **Finnish stemmed full-text search**, indexed `pg_trgm` typo/compound fallback, and an **English-compatible search path**, using a current-recipe search document and ranking favoring names, then ingredients, then directions/notes. Validate about 30 Finnish/English golden search cases prior to finalizing indexes. No dedicated search service is required for P0.

**Validation is not a reopened architecture selection:** the selected technologies/approach above are approved; spikes check implementation feasibility and tune details. If a spike discovers a material blocker, document it as a new ADR rather than silently changing the baseline.

## 13. Deferred post-MVP scope (review completed)

All remaining priority decisions have been reviewed and resolved. The following features are explicitly **outside the P0/MVP scope**. P1 indicates a potential post-MVP enhancement, not a commitment to a release date.

| Ref | Deferred enhancement | Why it may matter | Agreed priority |
|---|---|---|---|
| FR-15 | Conversational refinement of imported recipe drafts | Lets the user correct extraction by chatting rather than manual form edits | **P1 — confirmed** |
| FR-27 | Contextual chat on an individual recipe page | Convenient editing/feedback; core database operations already supported | **P1 — confirmed** |
| FR-33 | Enhanced member activity view, favorites and conflict warnings | Could improve collaboration; baseline conflict safety remains P0 | **P1 — confirmed** |
| UI-i18n | Additional translated interface language(s) | Translation-ready UI architecture is already P0; actual translations are optional | **P1 — confirmed** |
| Other | Advanced taxonomy, importer batch operations, calendar integration, full pantry inventory, offline shopping mutations and nutrition analytics | Additional capabilities not necessary for the first release; detailed requirements to be developed when prioritized | **P1 — deferred** |

## 14. Definition of done for MVP

Two household members can securely sign in over an internet-accessible HTTPS endpoint; maintain separate dietary/goal profiles and recurring activity schedules; import, review, find, modify and version shared recipes; record cooking feedback; plan the five daily meal slots for a week using member-specific attendance, fitness goals and pragmatic portion recommendations, **persist planned recipe scaling and open the appropriately scaled recipe from the calendar**; discover and optionally approve new AI-suggested recipes; manage multiple **live-synchronized** shared categorized shopping lists including non-food items directly on mobile, with same-plan generated item consolidation and manual-row separation; add a weekly plan's shopping requirements to a selected list; and restore all key household data from backup. Core recipe and shopping features remain operational without AI service availability.

---

**Document history**

- **v0.1 (26 October 2026):** Initial working specification.
- **v0.2 (26 October 2026):** Integrated individual dietary goals, exercise and attendance schedules, five daily meal slots, member-specific portions, expanded new-recipe behavior, mandatory independent shopping lists, stronger internet-exposure security, name search versus future full-text search, confirmed product decisions and explicit P1 review queue.

- **v0.3 (26 October 2026):** Confirmed plan-specific recipe scaling, live shopping-list sync, and language decisions.
- **v0.4 (26 October 2026):** Promoted FR-07 to P0.

- **v1.0 (26 October 2026):** Finalized the P0/MVP baseline. Confirmed FR-07 as P0; retained FR-15 and FR-27 in P1; confirmed FR-33, UI-i18n and all remaining deferred enhancements as P1. Completed the scope review with no unresolved prioritization decisions.
- **v1.1 (26 October 2026):** Clarified original recipe-unit preservation versus pragmatic quantities for recipe-free meal accompaniments; included accompaniments in plans and shopping requirements. No prioritization changes.
- **v1.2 (26 October 2026):** Integrated design review and owner decisions: incremental releases, safeguarded nutrition engine, Authelia/MFA/device sessions, revised shopping merge/reconciliation, ingredient model, plan/leftover model, shared profile visibility and P1 offline shopping.

- **v1.3 (27 October 2026):** Clarified authentication alternatives: verified passwordless passkey or password + TOTP through Authelia OIDC; final configuration remains subject to security validation. No MVP scope change.

- **v1.4 (27 October 2026):** Recorded approved ADR-002 (Drizzle/Drizzle Kit), ADR-007 (Fineli-based hybrid with optional best-effort matching), and ADR-010 (Finnish FTS + trigrams + English) without changing MVP scope.


## 15. Baseline control and implementation gates

**Product Specification v2.0, as amended by v2.1, is frozen** as the product-scope baseline for Milestones A–D. This freeze does not imply all planned features are already implemented or engineering validation is complete. Track changes by an explicit issue/change request and update the baseline only after approval; milestone-level designs and tests may evolve without silently changing requirements.

- **Milestone A gate:** Drizzle/PostgreSQL and Finnish search validation; Authelia OIDC/session-freshness and lost-device prototype; recipe/ingredient and shopping-origin modeling; API contracts and idempotency for A operations.
- **Milestone B gate:** Configured AI-provider usage budget, hard-stop behavior and importer-specific safety/cost tests before importer AI goes live.
- **Milestone C gate:** Nutrition equation/safeguards, Fineli integration, ingredient coverage and activity handling before the planning/nutrition implementation goes live.
- **Milestone D gate:** Re-evaluate AI budget and safeguards for the planning workflow, plan-to-list reconciliation and approval transitions.

**v2.0 change log (27 October 2026):** Strengthened revocation/fresh-authentication acceptance conditions; clarified P0 guidance-document boundary; aligned implementation gates with independently usable milestones; frozen the approved product baseline.

**Editorial correction (27 October 2026, no requirement change):** aligned the leftover link to component level and clarified the frozen-baseline version reference.

**v2.1 change log (27 October 2026):** Controlled post-freeze amendment for ADR-008 provider independence; OpenAI remains first and only required implementation. Updated AI contract, privacy/cost language, deployment diagram and configuration expectations. No new P0 feature delivery.
