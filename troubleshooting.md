# Troubleshooting

## Blank blue screen at `http://127.0.0.1:5173`

### Symptom
- Browser loads, but app shows a blank blue screen.
- Console shows:
  - `ReferenceError: evolutionFamilyMembers is not defined`
  - Stack includes bundled file like `index-*.js`.

### Root cause
- Frontend runtime crash in `app/src/App.tsx`.
- `evolutionFamilyMembers(...)` was used but not imported.
- This is an app code error, not a localhost/browser/Java issue.

### Fix applied
- Added missing import in `app/src/App.tsx`:
  - `evolutionFamilyMembers` from `./evolution.ts`.
- Rebuilt app successfully with:
  - `npm.cmd run build`

### Verify
1. Start server:
   - `npm.cmd run dev`
2. Open:
   - `http://127.0.0.1:5173`
3. Hard refresh:
   - `Ctrl+Shift+R`
4. Confirm no `evolutionFamilyMembers is not defined` error in console.

## If browser says `127.0.0.1 refused to connect`

### Meaning
- No process is listening on port `5173`.

### Fix
1. In terminal:
   - `cd C:\Code\pokemon-go`
   - `npm.cmd run dev`
2. Keep that terminal window open.

## Optional: bypass a bad cached local origin

If one local origin is poisoned/sticky, run dev on another port:

```powershell
$env:PORT='5181'
npm.cmd run dev
```

Then open:
- `http://127.0.0.1:5181`

Notes:
- `scripts/dev-server.mjs` now supports `PORT` / `DEV_PORT`.
