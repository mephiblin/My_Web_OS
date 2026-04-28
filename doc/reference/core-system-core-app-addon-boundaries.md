# Core System, Core Apps, And Addons

Status: `[ACTIVE]`

This document defines the product boundary between the Web OS core system,
core apps, and Package Center-governed addons.

Use this as a design rule, not a loose metaphor.
When a feature feels ambiguous, classify it here before choosing a folder,
runtime, permission model, or lifecycle owner.

Related references:

- `AGENTS.md`
- `doc/reference/app-development-model.md`
- `doc/reference/package-ecosystem-guide.md`
- `doc/Addon_Dev_Ref/SECURITY_LIMITS_AND_APPROVALS.md`
- `doc/Addon_Dev_Ref/MANIFEST_PERMISSIONS_AND_EXTENSION_POINTS.md`

## 1. Core Principle

My Web OS is split into three product layers:

```text
Core System
  OS survival, trust, recovery, security, settings, file access, and platform control

Core Apps
  Basic built-in apps that let a user open, view, play, or do simple edits immediately after install

Addons
  Package Center-governed extensions that expand the user's workflow, domain tools, and personalization
```

The rule is not "important vs unimportant."
The rule is:

> If the feature disappears, does the OS stop being usable as an OS, or does
> the user's workflow merely become less capable?

The intended philosophy is:

> Core System protects survival and trust. Core Apps protect baseline
> usability. Addons expand the user's working world.

## 2. Design Goals

This separation exists to preserve all of the following at the same time:

- a small and reliable trusted core
- a predictable baseline user experience after first install
- a package-first addon ecosystem
- safe install, update, disable, and removal flows
- clear data ownership and permission review
- freedom for users to replace tools without destabilizing the OS

This means the platform should resist the habit of turning every useful feature
into a privileged built-in app.

## 3. Layer Definitions

### 3.1 Core System

Core System is the trusted operating surface required to keep Web OS alive,
recoverable, and safe.

Typical scope:

- account and authentication flows
- settings and policy management
- permission and approval systems
- session and window orchestration
- filesystem access control and file grant infrastructure
- trusted file browsing surfaces
- terminal approval and PTY orchestration
- Package Center lifecycle authority
- update, recovery, diagnostics, and logs
- network and system-level control surfaces

Classification rule:

- If removing it breaks login, settings, safe file access, recovery, package
  lifecycle, or platform trust, it belongs to Core System.

Core System may present as an app-like UI, but it is still core when it owns
platform authority rather than ordinary user workflow.

Examples in this project:

- File Station
- Terminal
- Settings / Control Panel
- Package Center
- transfer, update, backup, approval, and recovery surfaces

Non-goals for Core System:

- domain workflows like calendars, notes, markdown workspaces, RSS readers, or
  diagram tools
- user-preference tools that can be safely installed or replaced
- feature-specific business logic that should live in packages

### 3.2 Core Apps

Core Apps are built-in apps that preserve baseline usability immediately after
installation, but do not define OS survival.

Typical scope:

- open common local files
- preview common media
- perform simple edits on basic formats
- give the user a usable out-of-box desktop experience

Classification rule:

- If the OS still works without it, but first-run usability becomes noticeably
  degraded, it may be a Core App.

Core Apps should stay intentionally small.
They exist to prevent "I installed the OS and cannot open a basic file," not to
be the final answer for every workflow category.

Good Core App candidates:

- simple image viewer
- simple media player
- basic text editor
- basic document/PDF reader
- simple archive opener

Bad Core App candidates:

- full IDE
- advanced note workspace
- calendar suite
- Git client
- automation system
- rich productivity dashboards

### 3.3 Addons

Addons are optional extensions governed by the package model and Package Center
lifecycle.

Addon scope includes:

- ordinary application packages
- file handlers and editors
- widgets and dashboard surfaces
- optional workflow tools
- professional or niche utilities
- user-installed or user-removable feature packs

Classification rule:

- If the feature expands work style, domain capability, or personalization, and
  the OS remains fundamentally usable without it, it belongs to the addon
  ecosystem.

Addons are not "less important."
A calendar, markdown editor, or API client may be mission-critical to a given
user, but it still belongs in the addon layer if Web OS itself can survive,
recover, and function without it.

In this project, the default strategic target for ordinary new user-facing
features is:

```text
Package Center addon first
```

## 4. Packaging And Ownership Rules

The layer decision must map to ownership and filesystem location.

### 4.1 Core System

- Source usually lives under `client/src/apps/system/`
- Runtime is trusted built-in component orchestration
- Registration comes from built-in app seed / system registry
- Data boundary is platform-owned and host-shared where appropriate
- Lifecycle is owned by the OS, not by Package Center uninstall semantics

Core System must not be modeled as an ordinary removable sandbox package unless
the platform explicitly evolves to support that without weakening trust.

### 4.2 Core Apps

Core Apps may ship built-in for baseline usability, but they should be designed
to remain replaceable in principle.

Current practical shapes may include:

- built-in trusted app under `client/src/apps/system/` when it is part of the
  first-run baseline
- built-in standard app under `client/src/apps/addons/` during transition

But the long-term direction is still package-aware metadata and cleaner
replaceability.

### 4.3 Addons

Ordinary addons should be package-first.

Canonical addon runtime shape:

```text
server/storage/inventory/apps/<app-id>/
  manifest.json
  index.html
  assets/
  vendor/
```

Addon source may also temporarily exist in repo development folders such as
`client/src/apps/addons/<app-id>/`, but that is a development convenience, not
the final ecosystem contract.

Package Center owns:

- install
- update
- disable
- remove
- preflight review
- permission display
- rollback and backup visibility
- package-scoped metadata and runtime registration

Ordinary addons must not require direct edits to
`client/src/core/Desktop.svelte` or `client/src/core/Window.svelte` except when
adding a generic new platform capability.

## 5. Bundled Addons

Some features should be shipped by default while still belonging to the addon
layer.

This document formally allows the concept of a bundled addon:

> A bundled addon is included by default, but structurally remains an addon and
> should be removable, replaceable, and Package Center-governed.

Bundled addon criteria:

- useful for many users
- not required for OS survival
- can fail or be removed without breaking core trust
- may evolve faster than the core
- benefits from package lifecycle ownership

Likely bundled addon candidates:

- markdown editor
- notes
- calendar
- advanced screenshot tool
- clipboard manager
- richer PDF tool
- advanced archive manager

This is the preferred bucket for features that are "important to user
experience" but not "required to keep the OS alive."

## 6. Boundary Test

Use these questions in order.

### 6.1 Core System Test

If the answer is "yes" to any of these, classify as Core System:

- Without this feature, can the user no longer safely use or recover the OS?
- Does it own platform trust, permissions, approvals, settings, or lifecycle?
- Do other apps depend on it as a platform API or trusted control surface?
- Would uninstallability or casual replacement materially weaken security or
  system integrity?

### 6.2 Core App Test

If Core System is "no," ask:

- Should this be available immediately after install for baseline usability?
- Is its goal simple viewing, playback, or light editing of common content?
- Can it stay intentionally small and stable?

If mostly "yes," it may be a Core App.

### 6.3 Addon Test

If the feature is mainly about workflow expansion, domain logic, productivity,
specialization, or personalization, classify it as an addon.

Signals that strongly indicate addon:

- multiple reasonable replacements could exist
- different users will want different tools
- the feature benefits from faster release cadence
- it should be installable, removable, or replaceable
- it needs Package Center distribution and lifecycle semantics
- it can live on official APIs rather than owning platform authority

## 7. What Must Not Happen

To keep the boundary meaningful, avoid these anti-patterns:

- putting addon-specific business logic into desktop shell files
- classifying a workflow app as core just because it feels useful
- letting ordinary addons bypass approval, file grant, or sandbox contracts
- giving addons direct privileged access where an official API should exist
- treating package-inventory edits as proof that something is core
- assuming a UI that "looks system-like" is therefore Core System

## 8. Calendar As A Boundary Example

Calendar is the canonical example for this rule set.

The shared calendar API, permission contract, widget integration points, and
possible platform event standards may be core-owned platform surfaces.

But the ordinary calendar application experience itself is addon territory when
it is a user workflow tool rather than a survival function.

Therefore:

- core may own the calendar data API and permission contract
- core may expose widgets or integration hooks
- a user-facing calendar app can and should exist as a Package Center addon
- a bundled calendar addon is valid
- a calendar app must not become privileged Core System merely because calendars
  are valuable to users

This project should treat `calendar-addon` as an addon ecosystem artifact, not a
reason to grow the core without need.

## 9. Security And Permission Model

Addon freedom does not mean addon privilege.

Rules:

- addons request only the permissions they actually need
- high-risk host operations stay behind core-owned approval contracts
- addon failure must not compromise OS recovery or trust
- addon data and user host data remain clearly separated
- package lifecycle review must surface risk before activation

High-risk capabilities such as terminal execution, broad host file access,
background services, account token access, capture, and settings mutation should
remain narrowly granted and explicitly reviewed.

## 10. Decision Outcomes For This Repository

These are the practical repository rules derived from the philosophy above.

### 10.1 Default destination for new work

- Core survival or trusted platform control: `client/src/apps/system/`
- Baseline built-in usability app: only if there is a strong first-run reason
- Ordinary user feature or workflow tool: package addon

### 10.2 Canonical addon destination

- runtime package: `server/storage/inventory/apps/<app-id>/`
- optional in-repo development source: `client/src/apps/addons/<app-id>/`

### 10.3 Core shell restrictions

Keep these files orchestration-only unless a true platform capability is being
added:

- `client/src/core/Desktop.svelte`
- `client/src/core/Window.svelte`

### 10.4 Package Center authority

Ordinary addon install/remove/update semantics belong to Package Center, not to
ad hoc core registration shortcuts.

## 11. Short Classification Table

| If the feature mainly... | Then classify as... |
| --- | --- |
| keeps login, recovery, approval, settings, or trusted file control alive | Core System |
| lets the user open or lightly edit common files after install | Core App |
| expands workflow, specialization, or personalization | Addon |
| is shipped by default but should remain removable and replaceable | Bundled Addon |

## 12. Final Product Statement

The intended Web OS architecture is:

```text
Core System
  survival, trust, settings, file authority, recovery, package authority

Core Apps
  baseline view/open/play/edit utilities

Bundled Addons
  default-installed but removable workflow tools

Addons
  Package Center-governed optional extensions
```

Final philosophy:

> Core System must stay small, trusted, and recoverable.
> Core Apps must keep the OS usable out of the box.
> Addons must carry the user's workflow world without owning the platform.

