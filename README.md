# DVMotion

DVMotion — a motion graphics tool by MadeByDavron.

Created by MadeByDavron:
https://github.com/madebydavron

GitHub:
https://github.com/madebydavron/dvmotion

**Version 1.56.0**

An After Effects extension for text animation presets, title compositions, CTA clips and more.

Select a layer, double-click a card, done.

---

## 1. Install

### Option 1 — ZXP Installer (Recommended)

1. Download the latest **`DVMotion.zxp`**.
2. Install a ZXP extension installer such as **ZXP Installer**.
3. Drag `DVMotion.zxp` into the installer.
4. Wait until the installation finishes.
5. Restart After Effects if it is already open.

Then open:

**After Effects → Window → Extensions → DVMotion**

> If DVMotion does not appear after installation, restart After Effects completely and open it again.

---

### Option 2 — ZIP / Manual Installation

If you downloaded the `.zip` version:

1. Download `DVMotion.zip`.
2. Extract the ZIP file.
3. Copy the extracted **`DVMotion`** folder.
4. Put it into:

**Windows**

```text
C:\Users\<your-username>\AppData\Roaming\Adobe\CEP\extensions\
```

**macOS**

```text
~/Library/Application Support/Adobe/CEP/extensions/
```

5. Restart After Effects.
6. Open:

**After Effects → Window → Extensions → DVMotion**

> The ZIP version is mainly intended for manual installation and development. For normal users, the ZXP version is recommended.

---

## 2. Adding Your Own Content

DVMotion can load your own animation files directly from its folders.

You do not need to edit JSON for basic use.

Drop a file into the appropriate folder and press **↻ Refresh** in the panel.

| File                                         | Result                   |
| -------------------------------------------- | ------------------------ |
| `presets/SlideUp_IN.ffx` + `SlideUp_OUT.ffx` | Slide Up animation       |
| `presets/Bounce.ffx`                         | Bounce animation         |
| `titles/green_title.aep`                     | Green Title under Titles |
| `emoji/hearts.aep`                           | Hearts under Emoji       |
| `cta/subscribe.mov`                          | Subscribe under CTA      |
| `previews/SlideUp.png`                       | Still preview            |
| `previews/SlideUp.mp4`                       | Hover video preview      |

Preview files should use the same base name as the preset.

For example:

```text
presets/
    SlideUp_IN.ffx
    SlideUp_OUT.ffx

previews/
    SlideUp.png
    SlideUp.mp4
```

With both `.png` and `.mp4`:

* PNG is displayed normally.
* MP4 plays when you hover over the card.
* PNG is used as the poster.

---

## 3. Text Presets

### Creating a Preset

1. Create your animation on a text layer.
2. Select the layer.
3. Go to:

**Animation → Save Animation Preset…**

4. Save the `.ffx` file inside:

```text
DVMotion/presets/
```

You can use either:

```text
Name_IN.ffx
Name_OUT.ffx
```

or a single marker-driven preset:

```text
Name.ffx
```

5. Press **↻ Refresh** in DVMotion.

### Applying a Preset

| Action       | Result                              |
| ------------ | ----------------------------------- |
| Single click | Selects the preset                  |
| Double-click | Applies the preset                  |
| Enter        | Re-applies the last selected preset |

Presets are applied to your selected text layers.

The panel automatically handles the IN / OUT markers when the option is enabled.

---

## 4. IN / OUT Markers

When **Add IN / OUT markers** is enabled, DVMotion creates two markers:

| Marker | Time                 | Meaning                    |
| ------ | -------------------- | -------------------------- |
| `IN`   | In Point + Duration  | End of the IN animation    |
| `OUT`  | Out Point − Duration | Start of the OUT animation |

Re-applying a preset replaces existing `IN` / `OUT` markers instead of creating duplicates.

The **⚑** button can add the markers without applying a preset.

---

## 5. Slider Controls

Some presets require Slider Controls.

For example:

```text
Bounce Freq
Bounce Amplitude
Bounce Decay
```

You can define them with a JSON sidecar:

```text
presets/up.ffx
presets/up.json
```

Example:

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

DVMotion creates the required controls before applying the preset.

Existing controls are not duplicated or reset.

---

## 6. Titles

Titles are complete After Effects compositions, so they use `.aep` files instead of `.ffx`.

Put them inside:

```text
DVMotion/titles/
```

Example:

```text
titles/
    green_title.aep
    gold_title.aep
```

Double-clicking a title imports it into the current project.

### Title Behaviour

DVMotion can:

* Match the title frame rate to the current composition.
* Scale the title to the project size.
* Keep transformations sharp using Collapse Transformations.
* Insert the title as a single precomp.
* Optionally unpack the title into individual layers.

These options are available in **Settings ⚙**.

By default, titles are inserted as a single precomp.

---

## 7. Text Animations

Text animation compositions are stored in:

```text
DVMotion/texts/
```

Unlike regular titles, every insertion creates a **copy** of the composition.

This means you can insert the same text animation multiple times and edit the text independently.

---

## 8. Emoji

Animated emojis work like titles.

Put them inside:

```text
DVMotion/emoji/
```

Example:

```text
emoji/
    hearts.aep
    money.aep
    fire.aep
```

Each composition appears as its own card.

---

## 9. Bundles

You can store multiple compositions inside one `.aep`.

For example:

```text
titles/titles.aep
```

DVMotion can detect the compositions inside the file and create individual cards for them.

A sidecar file can also be used:

```text
titles/titles.json
```

Example:

```json
{
  "comps": [
    "green_title",
    "gold_title",
    "brown_title"
  ]
}
```

Only main compositions are listed.

Precomps used internally are not shown as separate cards.

---

## 10. CTA Clips

Put `.mov` or `.mp4` files inside:

```text
DVMotion/cta/
```

Example:

```text
cta/
    subscribe.mov
    follow.mp4
```

Double-click a CTA to insert it.

DVMotion automatically:

* Places it at the end of the composition.
* Scales it to the composition width.
* Centres it.
* Applies the CTA offset.

The offset can be changed in the panel.

---

## 11. Render & Send to Telegram

The **▶** button can render the active composition and send it directly to Telegram.

### Setup

Open:

**Settings ⚙**

Enter:

| Setting           | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| Bot Token         | Telegram bot token                                         |
| Chat ID           | Telegram chat/group ID                                     |
| Output Module     | After Effects render template                              |
| Render Settings   | After Effects render settings                              |
| Output Folder     | Where renders are saved                                    |
| API Server        | Telegram API server                                        |
| api_id / api_hash | Only required for advanced Telegram account/server options |

The project must be saved before rendering.

DVMotion uses **aerender** so After Effects remains usable while the render is running.

The panel displays render progress and upload progress.

---

## 12. Telegram File Size

Telegram's standard Bot API has a file upload limit.

If the rendered file is too large, DVMotion can automatically compress it using FFmpeg.

The original render is not modified.

The compressed file is saved as:

```text
filename_tg.mp4
```

Make sure **FFmpeg** is installed and available in your system PATH if you want automatic compression.

---

## 13. Troubleshooting

### DVMotion does not appear

1. Restart After Effects completely.
2. Make sure the extension was installed correctly.
3. Check:

**Window → Extensions → DVMotion**

If you installed the ZIP manually, make sure the folder is directly inside the CEP `extensions` directory.

---

### A new preset does not appear

Press:

**↻ Refresh**

Also check that the file is inside the correct folder:

```text
presets/
titles/
texts/
emoji/
cta/
```

---

### Preview does not play

Use an H.264 `.mp4` preview.

Some codecs, such as ProRes, may not play inside the panel.

---

### A title does not import

Make sure:

* The `.aep` file is valid.
* The project is saved.
* You are not currently inside the title composition itself.
* After Effects has focus.

---

### Telegram upload fails

Open the panel log using the **☰** button.

Common errors:

| Error                          | Possible cause                   |
| ------------------------------ | -------------------------------- |
| `Unauthorized`                 | Wrong bot token                  |
| `chat not found`               | Wrong Chat ID                    |
| Upload stuck at 0%             | Network/API connection issue     |
| Render completed but no upload | Output file could not be found   |
| `aerender` error               | Invalid render/template settings |

---

## 14. Project Structure

A typical DVMotion installation looks like:

```text
DVMotion/
│
├── presets/
│   ├── SlideUp_IN.ffx
│   ├── SlideUp_OUT.ffx
│   ├── Bounce.ffx
│   └── library.json
│
├── titles/
│   ├── green_title.aep
│   └── titles.aep
│
├── texts/
│   └── text_animation.aep
│
├── emoji/
│   └── hearts.aep
│
├── cta/
│   └── subscribe.mp4
│
├── previews/
│   ├── SlideUp.png
│   └── SlideUp.mp4
│
└── VERSION.txt
```

---

## 15. Updating DVMotion

When a new version is released:

### ZXP

Install the new `.zxp` over the previous version using your ZXP installer.

### ZIP

Replace the old DVMotion extension folder with the new version.

Your personal presets and assets should be backed up before replacing the folder.

---

## 16. Version

**DVMotion 1.56.0**

After Effects CEP extension for:

* Text animation presets
* Titles
* Text animation compositions
* Emoji
* CTA clips
* Preview thumbnails and hover videos
* IN / OUT markers
* Custom slider controls
* Telegram rendering and delivery
* Custom library categories
