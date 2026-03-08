# Library Circulation Page MVP

This repo contains a standalone HTML/CSS/JS circulation page for a staff-operated library workflow. It uses Firebase Auth for admin login and Firestore for books, patrons, loans, holds, and admin role records.

## Files

- `index.html`: GitHub Pages entry page with Firebase config placeholder
- `library-catalog.css`: UI styling
- `app.js`: app wiring and UI coordination
- `firebase-init.js`: Firebase client SDK bootstrap
- `auth.js`: admin auth and role validation
- `inventory.js`: inventory reads/writes
- `patrons.js`: patron creation and session loading
- `circulation.js`: checkout, hold, and return transaction logic
- `login-view.js`, `inventory-view.js`, `circulation-view.js`: DOM bindings
- `firestore.rules`: admin-only Firestore access rules
- `firestore.indexes.json`: composite indexes for patron session queries
- `firebase.json`: Firebase CLI config for Firestore rules and indexes
- `scripts/seed-admin.mjs`: seeds or reuses an Auth user and ensures the matching admin role doc

## Firebase setup

1. Create a Firebase project.
2. Enable Email/Password in Firebase Authentication.
3. Create a Firestore database.
4. Replace the placeholder `window.LIBRARY_CATALOG_FIREBASE_CONFIG` values in `index.html`.
5. Install the admin tooling dependency:

```bash
npm install
```

6. Download a Firebase service account JSON file and point `GOOGLE_APPLICATION_CREDENTIALS` at it.
7. Run the seeding command to create or reuse the Auth user and write the matching `users/{uid}` admin doc.

## Firestore deployment

Deploy the rules and indexes with the Firebase CLI:

```bash
npx firebase deploy --project YOUR_PROJECT_ID --only firestore
```

## Exact setup commands

```bash
npm install
export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/service-account.json"
npm run seed:admin -- "admin@library.org" "StrongPassword123!"
npx firebase deploy --project YOUR_PROJECT_ID --only firestore
```

## GitHub Pages notes

Push this repo to GitHub and enable GitHub Pages for the repository root. Because the entry file is now `index.html` and `.nojekyll` is present, the site can be served directly by GitHub Pages without a build step.

If you want to test locally before pushing:

```bash
python3 -m http.server 8000
```

## Important implementation note

The hold queue is stored on each `books/{barcode}` document as internal metadata so checkout, hold, and return operations can stay fully transactional in the browser client. The required public fields from the MVP spec are still written, and the extra queue metadata is only there to keep return processing deterministic without a backend function.
