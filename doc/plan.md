# Firebase Auth (Google) + Firestore Cloud Sync for WebCAD

## Context

WebCAD currently saves drawings only to the browser's IndexedDB (`packages/storage`), via a mature autosave pipeline (`packages/core/src/autosave/`) that already has an unused extension seam, `IAutosaveRemote`, explicitly built for exactly this purpose — its own doc comment says "A collaboration server would implement this and call `setAutosaveRemote` during startup, without the scheduler, the store, or the indicator changing." A placeholder `ShareDocument` command also already advertises "hosted storage" as a "version 2" feature that was never built.

The goal: let a user sign in with Google, have their drawings automatically sync to Firestore via the existing autosave loop, and let them reopen a cloud-saved drawing from another device/browser via a new "Open from Cloud" menu. No email/password or guest auth. No Cloud Storage — large-drawing overflow is handled with a simple size guard, not chunking.

## Decisions locked in with the user

- **Auth method**: Google sign-in only (`signInWithPopup` + `GoogleAuthProvider`).
- **Sync trigger**: automatic, through the existing `AutosaveScheduler` → `IAutosaveRemote.push()` path. No separate manual "save to cloud" button.
- **Cross-device access**: yes — "Open from Cloud" lists the signed-in user's Firestore-saved drawings.
- **Oversized drawings** (Firestore's 1 MiB/doc cap): Firestore-only with a size-guard fallback. If a serialized drawing exceeds a safety threshold, surface a distinct "too large to sync" autosave state rather than attempting the write (no Cloud Storage for v1).
- **Firebase projects**: one shared project for dev and prod (simplest; revisit later if needed).
- **"Open from Cloud" UI**: a dropdown menu on the sign-in avatar/control, not a separate ribbon button — only meaningful when signed in, so this avoids extra enablement plumbing.

## New package: `packages/firebase`

Mirrors the `packages/storage` precedent: a thin wrapper around a concrete SDK, implementing interfaces defined in `@draftworks/core`. Keeps the Firebase SDK dependency out of `core`, `app`, and `ui`.

- `packages/firebase/package.json` — `"name": "@draftworks/firebase"`, depends on `firebase` (npm package) and `@draftworks/core`.
- `packages/firebase/src/firebaseApp.ts` — one memoized `initializeApp(config)` / `getAuth()` / `getFirestore()`, shared by the auth service and the autosave remote.
- `packages/firebase/src/firebaseAuthService.ts` — `FirebaseAuthService implements IAuthService`.
- `packages/firebase/src/firestoreAutosaveRemote.ts` — `FirestoreAutosaveRemote implements IAutosaveRemote`.
- `packages/firebase/src/firestoreCloudDocuments.ts` — `listCloudDocuments(uid)` / `fetchCloudDocument(uid, id)` for the Open-from-Cloud menu.
- `packages/firebase/src/index.ts` — re-exports, matching `packages/storage/src/index.ts`'s style.

## Auth service (interface in core, implementation in `firebase`)

`packages/core/src/auth/authUser.ts`:
```ts
export interface AuthUser {
    readonly uid: string;
    readonly displayName: string | null;
    readonly photoURL: string | null;
}
```

`packages/core/src/auth/authService.ts` — interface + singleton accessor pair, following `autosaveRemote.ts`'s `setAutosaveRemote`/`getAutosaveRemote` pattern exactly (not a full `IService`, since auth state must exist before `Application`/documents exist, and `onAuthStateChanged` has no natural `register/start/stop` lifecycle to hook into):
```ts
export interface IAuthService {
    readonly currentUser: AuthUser | undefined;
    signIn(): Promise<AuthUser>;
    signOut(): Promise<void>;
}
export function setAuthService(service: IAuthService | undefined): void
export function getAuthService(): IAuthService | undefined
```

Add `"authStateChanged"` to the `PubSub` event-map (next to `"activeViewChanged"`/`"documentDirty"` in `packages/core/src/foundation/pubsub.ts`), payload `AuthUser | undefined`. `FirebaseAuthService` publishes it from its internal `onAuthStateChanged` subscription, set up once in its constructor.

`FirebaseAuthService.signIn()` wraps `signInWithPopup`; catches popup-blocked/cancelled Firebase error codes and rethrows a plain translatable `Error` rather than leaking the Firebase error shape into UI code.

## Firestore data model

```
users/{uid}/documents/{docId}
  name: string           // from Serialized.name
  data: Serialized        // Document.serialize() output, unmodified
  updatedAt: Timestamp    // serverTimestamp(), used for cloud recency ordering
  sizeBytes: number       // size at write time, for the guard below
```

`docId` = the existing `document.id` (same id already used as the IndexedDB key) — no id-mapping needed.

**Size guard** (replaces Cloud Storage for v1): in `FirestoreAutosaveRemote.push()`, compute the serialized byte size before writing. If it exceeds ~900 KiB (headroom under Firestore's 1 MiB cap):
- Reject with a distinct `DocumentTooLargeError(id, size)` — not a generic error.
- Add a new `AutosaveState` value, `"tooLargeToSync"`, in `packages/core/src/autosave/autosaveState.ts`. In `AutosaveScheduler.push()`'s catch block, special-case this error: set `"tooLargeToSync"` and **skip** `enqueueSync` (retrying can never succeed, unlike a transient offline failure). This keeps the "visible, named states" philosophy the scheduler already uses for `"error"`/`"offline"` instead of silently dropping cloud sync.
- The existing `AutosaveControl` ribbon indicator (`packages/ui/src/ribbon/autosaveControl.ts`) needs its state→label mapping (`autosaveStateLabel`/`autosaveStateShortLabel`) extended to describe this state.

## `FirestoreAutosaveRemote`

```ts
export class FirestoreAutosaveRemote implements IAutosaveRemote {
    async push(id: string, data: Serialized): Promise<void> {
        const user = getAuthService()?.currentUser;
        if (!user) throw new Error("not signed in"); // scheduler queues + marks "offline" — correct, matches push()'s documented reject contract

        const size = byteSizeOf(data);
        if (size > SAFE_SIZE_LIMIT) throw new DocumentTooLargeError(id, size);

        await setDoc(doc(firestore, "users", user.uid, "documents", id), {
            name: data["name"],   // confirmed present — Document.serialize() includes it (packages/app/src/document.ts:76)
            data,
            updatedAt: serverTimestamp(),
            sizeBytes: size,
        });
    }
}
```

Not-signed-in rejects (never silently drops) so `AutosaveScheduler`'s existing `enqueueSync`/offline-queue machinery picks it up and retries once signed in. `AutosaveService` needs one small addition: also drain the sync queue on `"authStateChanged"` transitioning from signed-out to signed-in (today it only retries on the browser `"online"` event).

## Sign-in control + command

Single toggling command — `packages/app/src/commands/application/signInCommand.ts`:
```ts
@command({ key: "auth.toggle", icon: "icon-user", isApplicationCommand: true })
export class ToggleSignIn implements ICommand {
    async execute(): Promise<void> {
        const auth = getAuthService();
        if (!auth) return;
        if (auth.currentUser) await auth.signOut();
        else {
            try { await auth.signIn(); }
            catch (error) { Logger.warn("sign-in failed", error); /* toast via existing PubSub showToast */ }
        }
    }
}
```
Export it from `packages/app/src/commands/application/index.ts` alongside `shareDocument.ts`.

New ribbon Web Component, `packages/ui/src/ribbon/authControl.ts` + `authControl.module.css` — structural sibling of `autosaveControl.ts`:
- Subscribes to `"authStateChanged"` via `PubSub`.
- Signed out: renders a "Sign In" button/icon; click runs `auth.toggle`.
- Signed in: renders the user's avatar (`photoURL`) + `displayName`; click opens a small dropdown menu with two items: **"Open from Cloud"** (dispatches the `doc.openFromCloud` command below) and **"Sign Out"** (dispatches `auth.toggle`). This is what makes Open-from-Cloud "only available when signed in" for free — the menu item simply isn't rendered otherwise.

Registration as a ribbon widget (same path `autosaveStatus` already uses):
1. `packages/core/src/ui/button.ts` — extend `RibbonWidgetKind` with `"authStatus"`.
2. `packages/ui/src/ribbon/ribbonGroup.ts` — add the `"authStatus"` → `new AuthControl()` branch in `createRibbonWidget`.
3. `packages/builder/src/ribbon.ts` — add `{ type: "widget", widget: "authStatus" }` to the Import/Export group's `items`, before the existing `autosaveStatus` entry ("who you are" before "what's been saved").

## "Open from Cloud"

Command `packages/app/src/commands/application/openFromCloud.ts`, key `doc.openFromCloud` — invoked only from the `AuthControl` menu (not a ribbon button):
```ts
async execute(app: IApplication): Promise<void> {
    const user = getAuthService()?.currentUser;
    if (!user) return;
    const docs = await listCloudDocuments(user.uid); // ordered by updatedAt desc
    PubSub.default.pub("showDialog", "cloud.open.title", buildListContent(app, user.uid, docs), [
        { content: "cloud.open.cancel" },
    ]);
}
```
Each row, on click:
```ts
const data = await fetchCloudDocument(uid, docId);
if (data) await app.loadDocument(data);
```
Confirmed via `packages/app/src/application.ts:230` that `loadDocument(data: Serialized)` is the correct entry point — `openDocument(id)` (line 215) only reads local storage via `Document.open`, so it cannot load a drawing that exists in Firestore but not yet in this browser's IndexedDB. `loadDocument` is the same method `loadDocumentsWithLoading` already uses for drag-and-drop file imports. After loading, the next autosave tick naturally re-persists the drawing into local IndexedDB/recents — no special-casing needed.

Dialog content follows `ShareDocument`'s pattern exactly (`PubSub.default.pub("showDialog", title, contentElement, buttons)`, `@draftworks/element` builders, a sibling `.module.css`).

## Config wiring

Extend `rspack.config.ts`'s existing `DefinePlugin` block (no `.env` support — Firebase web config is not a secret, and the codebase has no dotenv infrastructure to justify adding for this):
```ts
new rspack.DefinePlugin({
    __APP_VERSION__: ...,
    __DOCUMENT_VERSION__: ...,
    __IS_PRODUCTION__: ...,
    __FIREBASE_CONFIG__: JSON.stringify(firebaseConfig),
}),
```
Declare `__FIREBASE_CONFIG__`'s shape alongside the other `declare const __*__` globals (wherever `__APP_VERSION__` is declared). The actual config values (apiKey, authDomain, projectId, etc.) come from the user's real Firebase project, created via the Firebase console — not fabricated here.

`AppBuilder` gets a new `useFirebaseAuth()` init method (pattern-matching `useIndexedDB()`/`useWasmOcc()`): constructs `FirebaseAuthService` with `__FIREBASE_CONFIG__` and calls `setAuthService(...)`. Chained from `packages/web/src/index.ts`'s existing builder chain. Once signed in, `AppBuilder` also calls `setAutosaveRemote(new FirestoreAutosaveRemote())`; on sign-out, `setAutosaveRemote(undefined)` to revert to local-only autosave.

## Firestore security rules

New file `firestore.rules` at repo root (referenced by a `firebase.json` the user generates interactively via `firebase init firestore` against their real project — not authored here):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/documents/{docId} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```
Only the owner can read/write their own documents; no sharing rule (out of scope, same "version 2" boundary `ShareDocument` already draws).

## Build/sequencing

1. **Auth only** — `packages/firebase` scaffold, `IAuthService`/`AuthUser`, `FirebaseAuthService`, `"authStateChanged"` event, `AuthControl` + `authStatus` widget registration, `ToggleSignIn` command, `DefinePlugin`/global-type wiring, `AppBuilder.useFirebaseAuth()`. Verify: sign in/out with Google, ribbon reflects state — zero Firestore code touched yet.
2. **Firestore push** — `FirestoreAutosaveRemote`, size guard + `DocumentTooLargeError` + `"tooLargeToSync"` state, `AppBuilder` wiring `setAutosaveRemote` on sign-in/out, `AutosaveService` retrying the sync queue on `"authStateChanged"`. Verify: edit while signed in, see the Firestore document appear and update; sign out, confirm local-only autosave resumes; go offline, confirm `"offline"` + queued retry.
3. **Open from Cloud** — `firestoreCloudDocuments.ts`, `OpenFromCloud` command, `AuthControl`'s dropdown menu. Verify: save on one browser profile, open the app in a second profile signed in as the same account, pull the drawing down, confirm it opens and that it re-syncs locally afterward.
4. **Rules + size-guard tuning** — deploy `firestore.rules`, confirm a non-owner uid is denied; tune `SAFE_SIZE_LIMIT` against a real large exported drawing.

## Key files

- `packages/core/src/autosave/autosaveRemote.ts`, `autosaveScheduler.ts`, `autosaveState.ts` — remote seam + new state
- `packages/core/src/auth/authUser.ts`, `authService.ts` — new
- `packages/core/src/foundation/pubsub.ts` — new event
- `packages/core/src/ui/button.ts` — new widget kind
- `packages/firebase/src/*` — new package
- `packages/ui/src/ribbon/authControl.ts` (+ `.module.css`) — new, sibling of `autosaveControl.ts`
- `packages/ui/src/ribbon/ribbonGroup.ts` — widget resolution
- `packages/app/src/commands/application/signInCommand.ts`, `openFromCloud.ts` — new, siblings of `shareDocument.ts`
- `packages/app/src/application.ts` — confirms `loadDocument`/`openDocument` signatures (no changes needed)
- `packages/builder/src/appBuilder.ts`, `ribbon.ts` — wiring
- `packages/web/src/index.ts` — builder chain
- `rspack.config.ts` — `DefinePlugin`
- `firestore.rules` — new, repo root
