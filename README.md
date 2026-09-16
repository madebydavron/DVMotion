# DVMotion

**Version 1.56.0**

An After Effects CEP panel for your own text animation presets, title compositions and CTA clips.
Select a layer, double-click a card, done.

---

## 1. Install

### 1.1 Turn on debug mode (required for unsigned extensions)

**Windows** — `regedit` → `HKEY_CURRENT_USER\Software\Adobe\CSXS.11`
Add a **String (REG_SZ)** called `PlayerDebugMode` with the value `1`.
Do the same for CSXS.9, CSXS.10, CSXS.11 and CSXS.12 — the number depends on your AE version.

**macOS** — in Terminal:
```
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
killall cfprefsd
```

### 1.2 Copy the folder

Put the whole `ByDavron-TextAnim` folder into:

- **Windows:** `C:\Users\<you>\AppData\Roaming\Adobe\CEP\extensions\`
  (or `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\` — needs admin)
- **macOS:** `~/Library/Application Support/Adobe/CEP/extensions/`

### 1.3 Open it

After Effects → **Window → Extensions → DVMotion**

Not showing up? Quit AE completely and reopen, then check the `Host Version` range in `manifest.xml`
and the CSXS number you used for the debug key.

---

## 2. Adding your own content

The panel reads the `presets/`, `titles/` and `cta/` folders directly — you do not have to edit any
JSON. Drop a file in, press **↻** in the panel, and it appears.

| File you drop | What you get |
|---|---|
| `presets/SlideUp_IN.ffx` + `presets/SlideUp_OUT.ffx` | "Slide Up" with both directions |
| `presets/Bounce.ffx` | "Bounce" — marker-driven, both directions in one file |
| `titles/green_title.aep` | "green title" under Titles |
| `emoji/hearts.aep` | "hearts" under Emoji |
| `titles/titles.aep` + `titles/titles.json` | one card per composition inside the bundle |
| `cta/subscribe.mov` | "subscribe" under CTA |
| `previews/SlideUp.png` | still shown on the matching card |
| `previews/SlideUp.mp4` | plays on hover, with the `.png` as its poster |

Preview files must share the base name of the preset, without `_IN` / `_OUT`.

Drop in **both** a `.png` and an `.mp4` with the same name and you get the behaviour you want: the
still sits there, and the clip plays only while the pointer is over the card. With just an `.mp4` the
first frame is used until you hover; with just a `.png` the card stays static.

Anything you place by hand wins over what the panel finds on its own, and a `preview` /
`previewVideo` entry in `library.json` wins over both.

Auto-detected presets default to a 1 s duration — change it in the Duration field, or pin an exact
value through `library.json` (section 5).

---

## 3. Text presets

### Making one

1. Build the animation on a text layer — **Animate → Scale / Position / Opacity…**, sliders,
   expressions, whatever you need.
2. Select the layer, then **Animation → Save Animation Preset…**
3. Save into `presets/`. Two naming options:
   - `Name_IN.ffx` + `Name_OUT.ffx` — separate keyframed presets for each direction.
   - `Name.ffx` — one file holding both animators, driven by the IN / OUT markers.
     The panel applies it once at the layer's start and writes **both** markers,
     whichever mode button is active.
4. Press **↻**.

A `.ffx` file stores effect controls, animators, keyframes and expressions. It does **not** store
layer markers — the panel adds those for you.

### Applying

| Action | Result |
|---|---|
| Single click | Selects the card, loads its duration into the field |
| Double-click | Applies it to every selected text layer |
| Enter | Re-applies the last selected card |

Sections can be reordered: grab a section heading by its handle and drag it above or below another
one. A blue line shows where it will land, and the order is remembered.

The slider in the bottom bar scales the thumbnails, and the checkboxes and the slider all remember
where you left them.

**Unpack into layers** is off by default for exactly this reason: the composition stays a single
precomp layer, nothing is copied, so parenting cannot break — and you edit the text through Essential
Graphics instead of digging into the timeline.
Previews are fitted rather than cropped, so a vertical title and a wide CTA both sit properly inside
the same card.

Results and errors appear as a toast above the bottom bar and dismiss themselves — 3 s for a result,
4.5 s for an error — or immediately via the close button. Following Spectrum, only one toast is on
screen at a time: a new one replaces whatever is there. The bottom bar holds only the size slider and
the version.

Presets are applied in both directions at once. A paired `Name_IN.ffx` / `Name_OUT.ffx` gets its IN
keyframes at the layer's in point and its OUT keyframes at `out point − duration`; a single
marker-driven `Name.ffx` is applied once at the layer's start. Either way both markers are written.

### Slider controls

If your preset's expressions call `effect("Bounce Freq")("Slider")`, those Slider Controls have to
exist on the layer. A `.ffx` only carries them when you had the **whole layer** selected at save time —
if you selected just the animator properties, they are missing.

Let the panel create them. Drop a sidecar JSON next to the preset, named after it:

`presets/up.json`
```json
{
  "duration": 1.0,
  "controls": {
    "Bounce Freq": 2,
    "Bounce Amplitude": 50,
    "Bounce Decay": 6
  }
}
```

The sliders go on before the preset is applied, so the expressions resolve immediately. A control the
layer already has is left alone, so re-applying never duplicates them or resets your tweaked values.

The sidecar can override anything an entry supports — `label`, `duration`, `single`, `preview`.
`presets/up.ffx.json` works too, if you prefer keeping the extension in the name.

For sliders shared by every preset, use `presets/controls.json` instead of one sidecar per file:

```json
{
  "*":  { "Bounce Freq": 2, "Bounce Amplitude": 50, "Bounce Decay": 6, "Out Duration": 0.6 },
  "up": { "Bounce Freq": 3 }
}
```

A preset's own key wins over `"*"`, and a sidecar file wins over both. The panel lists the sliders it
created in the status bar, so you can see straight away whether the names matched.

The panel version is shown in the status bar when it loads, and stored in `VERSION.txt`.

### IN / OUT markers

With **Add IN / OUT markers** ticked the panel writes two markers, following the same convention
AAPower-style expressions expect:

| Marker | Time | Meaning |
|---|---|---|
| `IN` | `in point + duration` | where the in-animation **ends** |
| `OUT` | `out point − duration` | where the out-animation **starts** |

Either way the animation runs for exactly the Duration value. Markers go down *before* the preset is
applied, so marker-driven expressions read the right time immediately.

This is what lets an expression like this work as soon as the preset lands:

```js
for (i = 1; i <= thisLayer.marker.numKeys; i++) {
  mk = thisLayer.marker.key(i);
  if (mk.comment == "IN") { tIn = mk.time; break; }
}
```

Re-applying replaces the existing `IN` / `OUT` marker instead of stacking a second one.
The **⚑** button adds the markers on their own, without touching the layers otherwise — handy when
you are writing the expression first and the preset second.

---

## 4. Titles

A title is a whole composition — box, glow, several text layers, parenting — so it cannot fit in a
`.ffx`. Each title lives as its own `.aep` file instead.

### Exporting a title

1. Select the title composition in your project (e.g. `green_title`).
2. **File → Save a Copy As…**
3. Open the copy, select that composition, **File → Dependencies → Reduce Project**.
4. **File → Save As** → `titles/green_title.aep`.

One `.aep` per title keeps each import clean.

### Sending files larger than 50 MB

The 50 MB cap belongs to Telegram's Bot API. No setting on our side moves it,
and `api_id` / `api_hash` on their own do nothing about it — they are
credentials for signing in, not a switch.

Three ways past it, in the order they are worth trying:

**Compress to fit** (on by default). If the render is over the limit the panel
re-encodes it with ffmpeg at a bitrate calculated to fit, and sends that. The
original is untouched; the smaller copy is saved as `<name>_tg.mp4`. Needs
ffmpeg on PATH. For a ten-second vertical clip at 15 Mbps this is usually all
that is needed — 6-8 Mbps looks the same and lands around 30 MB.

**Upload with your own account** (2 GB). Tick *Upload with my account*, fill in
`api_id` and `api_hash` from my.telegram.org, enter your phone, press
**Send code**, type the code Telegram sends you and press **Sign in**. The
session is stored so this happens once.

*Send to* takes `me` for Saved Messages, a `@username`, or a numeric chat id.

This signs in as you rather than as a bot. The session string in
`settings.json` is full access to your Telegram account, in plain text. Do not
share that file, and do not put the extension folder in a repository.

**Your own Bot API server** (2 GB). Run `telegram-bot-api` yourself and point
*API server* at it, e.g. `http://localhost:8081`. There is no official Windows
build, so this means compiling it — the account route above gets you the same
limit with far less work.

### When it does not work

The **&#9776;** button in the bottom bar opens `render.log` inside the panel.
**Send log** in Settings uploads that file to the chat, which helps when the
machine rendering is not the machine you are reading this on.

**Test Telegram** in Settings sends one message and reports exactly what
Telegram replied. That separates a wrong token or chat ID from a blocked
upload — they look identical otherwise.

Every render writes `render.log` in the extension folder: the aerender command
line, its exit code, the output file it found, and any failure. Error toasts
now stay on screen until you close them, so nothing scrolls past.

Common causes, in the order they usually turn out to be:

| Symptom | Cause |
|---|---|
| Render finishes, nothing uploads | The output file has a different name than expected. `render.log` shows what was found. |
| Upload stalls at 0 MB | The network is blocking `api.telegram.org`. Small messages get through, large uploads do not. |
| `chat not found` | Wrong chat ID, or you never sent the bot a message. |
| `Unauthorized` | Wrong or revoked bot token. |
| aerender exits non-zero | Usually a template name that does not exist in the project. |

### Behaviour

- Double-click imports the `.aep` and places the title at the current time indicator.
- **Match frame rate** sets the title's frame rate — and that of every precomp inside it — to the
  frame rate of the composition you are inserting into. A 25 fps title lands in a 30 fps project as
  30 fps, in a 60 fps project as 60 fps.
- **Scale to project size** scales the inserted layer instead of resizing the composition, so
  everything expression-driven inside it keeps working. A 1080×1920 title in a 2160×3840 comp goes in
  at 200%; the same title in a 1080 comp is left at 100%. The factor fits both dimensions, so an
  unusual aspect ratio never overflows.
- **Collapse transformations when scaled** keeps shapes and text sharp at any factor. Turn it off if
  effects inside the title render differently once collapsed — glows in particular.
- All three live in **Settings (gear)** and are remembered.
- By default the composition goes in as a **single precomp layer**. Nothing is copied, so parenting
  and expressions inside it cannot break, and you edit the text from outside through Essential
  Graphics. This is the recommended way to work.
- Tick **Unpack into layers** if you would rather have the composition's own layers pasted into the
  timeline. That path relies on After Effects' Copy/Paste, which needs the app to have focus and is
  more fragile.
- New layers land **above whatever is selected**. Nothing selected means top of the stack.
- Everything the panel imports goes under **one** root project folder:

  ```
  DVMotion
    Titles      main title comps
    Emoji       main emoji comps
    CTA         CTA footage
    Precomps    every nested comp and asset they depend on
  ```

  The names are fixed. They were editable for a while, and the only thing that ever changed was the
  chance of two projects disagreeing about where things live. **Tidy project** in Settings collects
  anything an earlier version scattered around into this structure.
- Only the composition you clicked is imported. A project file is all-or-nothing
  to After Effects — ask for one emoji out of twelve and it brings in all twelve
  plus every asset behind them — so the rest is deleted immediately afterwards,
  orphaned assets included.
- Importing the same title twice reuses what is already there — but only compositions under the root
  folder count, so a composition of yours that happens to share the name is never picked up.
- The destination is locked in the moment you double-click, so it cannot drift to the title's own
  viewer tab midway through.
- If the comp name inside the file does not match the filename, the panel picks the main composition
  (the one no other comp uses).
- Undo works, but the import and the paste are separate steps, so the first insert may need two
  presses of `Ctrl+Z`.

---

## 4a. Text animations

A `.ffx` preset lands on **your** text layer: your font, your size, your words.
A composition brings its own. Both are useful, for different things — keep
presets for plain text effects and compositions for designed lockups.

Text animation comps go in `texts/`. They get their own section, their own
`Text Anims` project folder, and one behaviour the others do not need:

**Each insert is a copy.** Placing the same composition twice would otherwise
put the same composition on the timeline twice — edit the text in one and it
changes in the other. For anything carrying its own text that is wrong, so the
panel duplicates it.

Emoji are not copied. They have no text to diverge, so a copy only leaves
`money fly 2` in the project for nothing.

The rest still applies: frame rate matching, scaling to the project size, the
`DVMotion` folder.

### Fitting the text to the composition

With no box layer, the composition itself is the boundary. On the text layer:

**Scale**

```js
padX = 60;
padY = 40;

text.sourceText;
r = sourceRectAtTime(time, false);

s = Math.min(100, Math.min((thisComp.width  - padX * 2) / Math.max(1, r.width),
                           (thisComp.height - padY * 2) / Math.max(1, r.height)) * 100);
[s, s]
```

**Anchor Point**

```js
text.sourceText;
r = sourceRectAtTime(time, false);
[r.left + r.width / 2, r.top + r.height / 2]
```

**Position**

```js
[thisComp.width / 2, thisComp.height / 2]
```

`text.sourceText;` on its own line is what forces the rect to be recalculated
when the text changes. Without it an Essential Graphics edit leaves the scale
where it was.

If the comp has IN / OUT markers and animators, read the rect at a resting time
between them instead of at `time` — otherwise the animation's own movement
changes the measured size and the text shrinks mid-animation.

---

## 4b. Emoji

Animated emojis work exactly like titles: one composition each, inserted at the current time
indicator, unpacked into layers or kept as a precomp. Put them in `emoji/` instead of `titles/` and
they get their own section and their own project folder.

---

## 4c. Bundles: many compositions in one .aep

A separate `.aep` per title gets unwieldy once you have twenty of them. Instead, keep **one** `.aep`
holding every title as its own composition, and the same for emoji.

Just drop the file in. The panel reads it by itself the first time it sees it and writes a sidecar
list next to it:

`titles/titles.json`
```json
{ "comps": ["green_title", "gold_title", "brown_title"] }
```

Each composition in that list becomes its own card, and double-clicking one drops that composition
into your timeline.

Reading a bundle does not touch your project. After Effects cannot look inside a project file, so the
panel imports it, notes the composition names and then removes the import again — the real import
happens later, only for the composition you actually use.

The sidecar also stores the `.aep`'s last-modified time. Add a composition to the bundle and save it,
and the panel notices the file changed and re-reads it by itself — no button to remember.

You can still edit the sidecar by hand: remove a name to hide that card, reorder to taste. Delete it
and the panel reads the `.aep` again on the next refresh. **Settings (gear) → Rescan bundles** forces
a re-read of everything.

Only *main* compositions are listed: anything used inside another composition is treated as a precomp
and left out.

Previews follow the composition name, not the file name — `previews/green_title.png`.

---

## 5. CTA clips

Drop `.mov` / `.mp4` files into `cta/` and press **↻**.

Double-click and the clip is:

- placed at the **end of the timeline** (`start = comp duration − clip duration`)
- scaled to the comp width — a 2160 px wide 4K clip becomes **50 %** in a 1080 px comp
- centred, then pushed down by the **CTA offset** value (200 px by default)

If the clip is longer than the composition it starts at 0 and the panel says so.

---

## 5b. Render and send to Telegram

The **&#9654;** button renders the active composition and posts it to a Telegram
chat, updating a single message with the percentage as it goes.

### Why aerender

`app.project.renderQueue.render()` locks After Effects until it finishes and
reports nothing while it works, so a progress percentage is impossible from
inside. The panel runs **aerender** instead — a separate process that prints one
line per frame. After Effects stays usable, and the percentage is real rather
than estimated.

### Setup

In **Settings (gear)**:

| Field | Meaning |
|---|---|
| Bot token | From @BotFather, looks like `123456:ABC-DEF...` |
| Chat ID | Where to post. Negative for groups, e.g. `-1001234567890` |
| Output module | Template name, e.g. `H.264 - Match Render Settings - 15 Mbps`. Blank uses the queue default, which is usually a very large lossless file. |
| Render settings | Template name, e.g. `Best Settings`. Blank uses the default. |
| Output folder | Blank means `<project folder>/renders` |
| API server | Blank uses `https://api.telegram.org`. Point it at your own Bot API server to lift the 50 MB cap to 2 GB. |
| api_id / api_hash | From my.telegram.org. Only needed by your own Bot API server — the panel stores them for reference, the server is what uses them. |

The token is stored in `settings.json` next to the extension, in plain text.
It is your own bot on your own machine, but treat that file accordingly.

To find a chat ID, message your bot once and open
`https://api.telegram.org/bot<token>/getUpdates`.

### Sending files larger than 50 MB

The 50 MB cap belongs to Telegram's Bot API. No setting on our side moves it,
and `api_id` / `api_hash` on their own do nothing about it — they are
credentials for signing in, not a switch.

Three ways past it, in the order they are worth trying:

**Compress to fit** (on by default). If the render is over the limit the panel
re-encodes it with ffmpeg at a bitrate calculated to fit, and sends that. The
original is untouched; the smaller copy is saved as `<name>_tg.mp4`. Needs
ffmpeg on PATH. For a ten-second vertical clip at 15 Mbps this is usually all
that is needed — 6-8 Mbps looks the same and lands around 30 MB.

**Upload with your own account** (2 GB). Tick *Upload with my account*, fill in
`api_id` and `api_hash` from my.telegram.org, enter your phone, press
**Send code**, type the code Telegram sends you and press **Sign in**. The
session is stored so this happens once.

*Send to* takes `me` for Saved Messages, a `@username`, or a numeric chat id.

This signs in as you rather than as a bot. The session string in
`settings.json` is full access to your Telegram account, in plain text. Do not
share that file, and do not put the extension folder in a repository.

**Your own Bot API server** (2 GB). Run `telegram-bot-api` yourself and point
*API server* at it, e.g. `http://localhost:8081`. There is no official Windows
build, so this means compiling it — the account route above gets you the same
limit with far less work.

### When it does not work

The **&#9776;** button in the bottom bar opens `render.log` inside the panel.
**Send log** in Settings uploads that file to the chat, which helps when the
machine rendering is not the machine you are reading this on.

**Test Telegram** in Settings sends one message and reports exactly what
Telegram replied. That separates a wrong token or chat ID from a blocked
upload — they look identical otherwise.

Every render writes `render.log` in the extension folder: the aerender command
line, its exit code, the output file it found, and any failure. Error toasts
now stay on screen until you close them, so nothing scrolls past.

Common causes, in the order they usually turn out to be:

| Symptom | Cause |
|---|---|
| Render finishes, nothing uploads | The output file has a different name than expected. `render.log` shows what was found. |
| Upload stalls at 0 MB | The network is blocking `api.telegram.org`. Small messages get through, large uploads do not. |
| `chat not found` | Wrong chat ID, or you never sent the bot a message. |
| `Unauthorized` | Wrong or revoked bot token. |
| aerender exits non-zero | Usually a template name that does not exist in the project. |

### Behaviour

- The project must be saved to disk. If it has unsaved changes the panel saves
  it first; if it has never been saved it refuses rather than guess.
- The whole composition is rendered, not the work area.
- Progress shows in the bottom bar as a percentage and a frame count, and in
  Telegram as a twelve-block bar:

  ```
  Rendering  erkak v ayol
  ███████░░░░░  58%
  174 / 300 frames
  ```

  Telegram rate-limits edits, so the message is only touched when the bar would
  actually look different, and never more than once every 3 seconds. One block
  is a little over 8%, which works out to roughly one edit per 8% of the render.
  The upload gets its own bar afterwards.
- Bots may upload 50 MB. A larger file is left on disk and Telegram gets its
  path instead.
- aerender is given an output path **without an extension**. The output module
  decides the container, not the panel, so guessing `.mp4` and then looking for
  `.mp4` was a good way to render a file and fail to find it. Afterwards the
  folder is searched for the newest file whose name starts with the composition
  name and which was written during this render.
- If nothing matches, `render.log` lists everything that is in the folder, so
  you can see what aerender actually produced.
- `.mp4` goes as a video with a player, anything else as a document.
- Clicking **&#9654;** during a render cancels it.

---

## 6. library.json (optional)

`presets/library.json` lets you pin exact values, group things into your own categories, and control
the order. Hand-written entries win over the automatic scan.

```json
{
  "categories": [
    {
      "name": "Basic",
      "items": [
        {
          "label": "Slide Up",
          "in":  "presets/SlideUp_IN.ffx",
          "out": "presets/SlideUp_OUT.ffx",
          "duration": 1.0,
          "preview": "previews/slideup.mp4"
        }
      ]
    },
    {
      "name": "Titles",
      "type": "titles",
      "items": [
        { "label": "Green Title", "file": "titles/green_title.aep", "comp": "green_title" }
      ]
    },
    {
      "name": "CTA",
      "type": "cta",
      "items": [
        { "label": "Subscribe", "file": "cta/subscribe.mov", "scale": 50, "offsetY": 200 }
      ]
    }
  ]
}
```

| Field | Applies to | Meaning |
|---|---|---|
| `in` / `out` | presets | Paths to the `.ffx` files. Either one may be omitted. |
| `duration` | presets | Seconds. Decides where OUT keyframes start. |
| `file` | titles, CTA | Path to the `.aep` or video file. |
| `comp` | titles | Composition name inside the `.aep`. Optional. |
| `unpack` | titles | `false` forces precomp mode for this title. |
| `scale` | CTA | Percent. Omit or use 0 for auto-fit. |
| `offsetY` | CTA | Pixels below centre. Overrides the panel field. |
| `single` | presets | `true` = one marker-driven file; applied once, both markers written. |
| `controls` | presets | Slider Controls to create, as `{ "Name": value }`. |
| `preview` | all | Path to the still image (or a clip, if that is all you have). |
| `previewVideo` | all | Path to the hover clip. |
| `type` | category | `titles` or `cta`. Leave it out for presets. |

---

## 7. Troubleshooting

**A new file does not show up** — press **↻**. Still missing? Check the extension is `.ffx` / `.aep` /
`.mov`, and that the file is inside `presets/`, `titles/` or `cta/`.

**Something is listed that no longer exists** — it is hand-written in `library.json`. Delete the entry.

**"Undo group mismatch, will attempt to fix" on every import** — fixed in
v1.47. An earlier version called `app.endUndoGroup()` defensively at the start
of each action, to clear a group that a bug in an even earlier version could
leak. After Effects does not treat that as a no-op when nothing is open: it
warns. The leak itself was fixed long before, so the guard was producing a
dialog and nothing else. It is gone.

**Panel is empty and says host.jsx did not load** — check the `ScriptPath` in `manifest.xml`.

**A title fails the first time after launching After Effects** — fixed across v1.24 and v1.26. Two
separate causes:

1. The import and the paste used to run in one script call. After Effects refuses to copy a layer
   that has a parent while an undo group from that call is still on the stack, so the paste failed.
   They are now two calls.
2. Menu commands act on whichever panel has focus. Called from an extension panel the focus is on the
   panel, so Copy and Paste quietly did nothing, and the panel fell through to `copyToComp()`, which
   raised the undo-group error. The panel now calls `app.activate()` first, retries the paste once,
   and closes the implicit undo group before the fallback.

3. A third cause, fixed in v1.27: the marker function opened an undo group without a `try`/`catch`
   around it, so any error inside left the group **open for the rest of the session**. An open undo
   group blocks every copy in After Effects — including your own Ctrl+C. Every entry point now closes
   a stray group before it does anything, and the ↻ button does the same, so the panel can release a
   lock rather than leaving you to restart the app.

If it ever still fails, the message tells you to click once in the timeline — that hands focus back to
After Effects and the next attempt goes through.

**Ctrl+C stopped working in After Effects itself** — something left an undo group open. Press ↻ in the
panel; that releases it without a restart.

**"That title is the composition you are in"** — you are inside the title comp itself. Click your own
composition's tab first. Pasting opens the title in a viewer, so this is easy to hit after an insert.

**A title reuses the wrong composition** — since v1.25 the panel only reuses titles it imported
itself, i.e. compositions under the `DVMotion - Titles` project folder. A composition of your own
with the same name is left alone.

**Preview does not play** — use H.264 `.mp4`. Chromium cannot decode ProRes, so keep previews separate
from the source clips.

**Preview does not appear at all** — a file that fails to load falls back to the letter tile, so a
blank card means the file is missing or unreadable. Check the name matches the preset exactly, minus
`_IN` / `_OUT`.

**"Can't copy a layer with a parent … while an Undo Group is open"** — fixed in v1.6. Replace the
folder with the current build.

**Debugging** — the panel's own right-click menu is disabled. Open the debug view from the CEP
remote-debug port instead (create a `.debug` file, then visit `localhost:<port>` in Chrome).
