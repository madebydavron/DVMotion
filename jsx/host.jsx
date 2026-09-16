/*  DVMotion  |  host.jsx
    Applies .ffx presets, title compositions and CTA clips to the active comp. */

/*  There used to be a bd_safeEnd() here that called app.endUndoGroup() at the
    start of every entry point, to clear a group some earlier version leaked.
    After Effects does not treat that as a no-op: with nothing open it warns
    "Undo group mismatch, will attempt to fix" on every single call.

    The leak it was papering over is gone - every beginUndoGroup below is now
    paired inside a try/catch - so the workaround was doing nothing but
    producing a dialog. */

function bd_deselectAll(comp) {
    var ls = comp.selectedLayers;
    for (var i = 0; i < ls.length; i++) ls[i].selected = false;
}

/* Topmost selected layer - new layers are placed above it */
function bd_topSelected(comp) {
    var ls = comp.selectedLayers;
    var best = null;
    for (var i = 0; i < ls.length; i++) {
        if (!best || ls[i].index < best.index) best = ls[i];
    }
    return best;
}

/* Moves a list of layers above the anchor, keeping their own order */
function bd_placeAbove(layers, anchor) {
    if (!anchor) return;
    for (var i = 0; i < layers.length; i++) {
        if (layers[i] === anchor) continue;
        try { layers[i].moveBefore(anchor); } catch (e) {}
    }
}

/* Marker property (the accessor differs between AE versions) */
function bd_markerProp(layer) {
    try { return layer.property("ADBE Marker"); }
    catch (e) { return layer.marker; }
}

/* Replaces a marker with the same comment, or adds a new one */
function bd_setMarker(layer, time, comment) {
    var mp = bd_markerProp(layer);
    if (!mp) return false;
    for (var i = mp.numKeys; i >= 1; i--) {
        if (mp.keyValue(i).comment === comment) mp.removeKey(i);
    }
    mp.setValueAtTime(time, new MarkerValue(comment));
    return true;
}

/* Adds Slider Controls the preset's expressions rely on.
   spec: "Bounce Freq=2|Bounce Amplitude=50|Bounce Decay=6"
   A control that already exists on the layer is left untouched. */
function bd_addControls(layer, spec) {
    var out = [];
    if (!spec) return out;

    var fx = layer.property("ADBE Effect Parade");
    if (!fx) return out;

    var parts = spec.split("|");
    for (var i = 0; i < parts.length; i++) {
        var raw = parts[i];
        if (!raw) continue;

        var eq = raw.lastIndexOf("=");
        var nm = (eq < 0) ? raw : raw.substring(0, eq);
        var vl = (eq < 0) ? 0 : parseFloat(raw.substring(eq + 1));
        if (isNaN(vl)) vl = 0;

        // Leave an existing control alone. property(name) may return null or throw.
        var found = null;
        try { found = fx.property(nm); } catch (e) { found = null; }
        if (found) continue;

        var ctl = fx.addProperty("ADBE Slider Control");
        if (!ctl) continue;
        ctl.name = nm;
        try { ctl.property("ADBE Slider Control-0001").setValue(vl); }
        catch (e2) { try { ctl.property(1).setValue(vl); } catch (e3) {} }
        out.push(nm);
    }
    return out;
}

/* Marker times. Convention matches AAPower-style expressions:
   the IN marker is where the in-animation ENDS, the OUT marker where the
   out-animation STARTS. So the animation always runs for `dur` seconds. */
function bd_markTimeIn(layer, dur) {
    var t = layer.inPoint + dur;
    return (t > layer.outPoint) ? layer.outPoint : t;
}
function bd_markTimeOut(layer, dur) {
    var t = layer.outPoint - dur;
    return (t < layer.inPoint) ? layer.inPoint : t;
}

/* Adds IN / OUT markers to the selected layers */
function bd_markSelected(dur, mode) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";
    var sel = comp.selectedLayers;
    if (sel.length === 0) return "No layer selected.";
    if (!dur || dur <= 0) dur = 1;

    var n = 0, err = null;
    app.beginUndoGroup("DVMotion - Markers");
    try {
        for (var i = 0; i < sel.length; i++) {
            var L = sel[i];
            if (mode === "in" || mode === "both") bd_setMarker(L, bd_markTimeIn(L, dur), "IN");
            if (mode === "out" || mode === "both") bd_setMarker(L, bd_markTimeOut(L, dur), "OUT");
            n++;
        }
    } catch (e) {
        err = e.toString();
    }
    app.endUndoGroup();

    if (err) return "Error: " + err;
    return "OK:Markers added to " + n + " layer(s).";
}

function bd_applyAt(comp, layer, file, time) {
    if (time < 0) time = 0;
    if (time > comp.duration) time = comp.duration;
    comp.time = time;
    bd_deselectAll(comp);
    layer.selected = true;
    layer.applyPreset(file);
}

/* ---------- TITLES (ready-made compositions) ---------- */

function bd_findComp(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem && it.name === name) return it;
    }
    return null;
}

function bd_findCompIn(folder, name) {
    for (var i = 1; i <= folder.numItems; i++) {
        var it = folder.item(i);
        if (it instanceof FolderItem) {
            var r = bd_findCompIn(it, name);
            if (r) return r;
        } else if (it instanceof CompItem && it.name === name) {
            return it;
        }
    }
    return null;
}

/* ---------- PROJECT ORGANISATION ----------
   Everything the panel imports lands under ONE root folder:

     DVMotion
       Titles      main title comps
       Emoji       main emoji comps
       CTA         CTA footage
       Precomps    every nested comp and asset they depend on

   The names are editable from the panel and arrive as
   "root|titles|emoji|cta|precomps". */

var BD_F = {
    root:     "DVMotion",
    titles:   "Titles",
    texts:    "Text Anims",
    emoji:    "Emoji",
    cta:      "CTA",
    precomps: "Precomps"
};

function bd_setFolders(spec) {
    if (!spec) return;
    var p = String(spec).split("|");
    if (p[0]) BD_F.root     = p[0];
    if (p[1]) BD_F.titles   = p[1];
    if (p[2]) BD_F.emoji    = p[2];
    if (p[3]) BD_F.cta      = p[3];
    if (p[4]) BD_F.precomps = p[4];
}

function bd_subFolder(parent, name) {
    for (var i = 1; i <= parent.numItems; i++) {
        var it = parent.item(i);
        if (it instanceof FolderItem && it.name === name) return it;
    }
    var f = app.project.items.addFolder(name);
    f.parentFolder = parent;
    return f;
}

/* kind: "titles" | "emoji" | "cta" | "precomps" | "root" */
function bd_dest(kind) {
    var root = bd_subFolder(app.project.rootFolder, BD_F.root);
    if (kind === "root") return root;
    return bd_subFolder(root, BD_F[kind] || kind);
}

/* True if the item sits anywhere under the given project folder */
function bd_isInFolder(item, folderName) {
    var p = item.parentFolder;
    while (p && p !== app.project.rootFolder) {
        if (p.name === folderName) return true;
        p = p.parentFolder;
    }
    return false;
}

/* Every non-folder item inside a folder tree */
function bd_collectAll(folder, out) {
    for (var i = 1; i <= folder.numItems; i++) {
        var it = folder.item(i);
        if (it instanceof FolderItem) bd_collectAll(it, out);
        else out.push(it);
    }
    return out;
}

function bd_pruneEmpty(folder) {
    for (var i = folder.numItems; i >= 1; i--) {
        var it = folder.item(i);
        if (it instanceof FolderItem) bd_pruneEmpty(it);
    }
    if (folder.numItems === 0) { try { folder.remove(); } catch (e) {} }
}

/* Sorts a freshly imported .aep into the structure above and returns the
   names of the comps that ended up as main items. */
function bd_organize(imported, kind) {
    var items = bd_collectAll(imported, []);
    var mainDest = bd_dest(kind);
    var preDest  = bd_dest("precomps");
    var names = [];

    // usedIn has to be read before anything moves
    var isMain = [];
    for (var i = 0; i < items.length; i++) {
        isMain[i] = (items[i] instanceof CompItem) && (items[i].usedIn.length === 0);
    }
    for (i = 0; i < items.length; i++) {
        if (isMain[i]) { items[i].parentFolder = mainDest; names.push(items[i].name); }
        else { items[i].parentFolder = preDest; }
    }

    bd_pruneEmpty(imported);
    return names;
}

/* Reuse a comp only if WE imported it, i.e. it lives under our root folder.
   Matching any same-named comp in the project is what made the panel grab the
   user's own composition - including the one they were working in. */
function bd_findImported(name) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (it instanceof CompItem && it.name === name && bd_isInFolder(it, BD_F.root)) return it;
    }
    return null;
}

/*  Removes everything in a freshly imported bundle except the one composition
    that was asked for, and whatever that composition depends on.

    Importing a project file is all-or-nothing: ask for one emoji out of twelve
    and After Effects brings in all twelve, plus every asset behind them. That
    is slow and it fills the project with things nobody asked for. So the rest
    is deleted straight afterwards, orphans included. */
function bd_pruneImport(imported, keepName) {

    var items = bd_collectAll(imported, []);
    var keep = null, others = [];

    for (var i = 0; i < items.length; i++) {
        if ((items[i] instanceof CompItem) && items[i].name === keepName) keep = items[i];
    }
    if (!keep) return null;

    // Other top-level comps first: they are what holds the extra assets alive
    for (i = 0; i < items.length; i++) {
        if (items[i] === keep) continue;
        if ((items[i] instanceof CompItem) && items[i].usedIn.length === 0) {
            others.push(items[i]);
        }
    }
    for (i = 0; i < others.length; i++) {
        try { others[i].remove(); } catch (e) {}
    }

    /*  Now sweep the leftovers. Removing a comp can orphan the assets it used,
        and removing those can orphan more, so this repeats until a pass
        changes nothing. */
    var changed = true, guard = 0;
    while (changed && guard++ < 12) {
        changed = false;
        items = bd_collectAll(imported, []);
        for (i = 0; i < items.length; i++) {
            if (items[i] === keep) continue;
            var used = 0;
            try { used = items[i].usedIn.length; } catch (e) { used = 1; }
            if (used === 0) {
                try { items[i].remove(); changed = true; } catch (e) {}
            }
        }
    }
    return keep;
}

function bd_getTitleComp(aepPath, compName, kind) {

    var f = new File(aepPath);
    if (!f.exists) throw new Error("Title file not found: " + aepPath);

    var src = bd_findImported(compName);
    if (src) return src;

    var imported = app.project.importFile(new ImportOptions(f));
    if (imported instanceof FolderItem) {
        bd_pruneImport(imported, compName);
        bd_organize(imported, kind || "titles");
        src = bd_findImported(compName);
    }
    if (!src) throw new Error("'" + compName + "' - no composition found in that file.");
    return src;
}

/* Reads the composition names out of an .aep WITHOUT leaving anything behind.

   After Effects has no way to look inside a project file, so the file is
   imported, its main compositions are listed, and the whole import is removed
   again. The project is left exactly as it was - the real import happens later,
   when a card is actually used. */
/*  Renders one frame of a comp into a square PNG.

    A temporary composition is used rather than the comp itself: emoji are all
    different shapes, and a square thumbnail that fits the artwork inside it
    looks like a set, where full-resolution frames of varying sizes do not. */
function bd_previewPng(comp, outPath, sizeL) {
    var tmp = null;
    try {
        var S = sizeL || 256;
        tmp = app.project.items.addComp("__bd_thumb__", S, S, 1,
                                        Math.max(0.04, comp.duration), 25);

        var L = tmp.layers.add(comp);
        var k = Math.min(S / comp.width, S / comp.height);
        L.property("ADBE Transform Group").property("ADBE Scale")
         .setValue([k * 100, k * 100, 100]);

        var png = new File(outPath);
        png.parent.create();

        // Middle of the comp: emoji tend to start and end empty
        tmp.saveFrameToPng(comp.duration * 0.5, png);
        tmp.remove();
        return true;
    } catch (e) {
        if (tmp) { try { tmp.remove(); } catch (e2) {} }
        return false;
    }
}

function bd_scanBundle(aepPath, kind, folderSpec, previewDir) {

    bd_setFolders(folderSpec);

    var f = new File(aepPath);
    if (!f.exists) return "Error: file not found: " + aepPath;

    // Same reason as bd_prepareTitle: no group around a project import.
    var err = null, names = [];
    try {
        var imported = app.project.importFile(new ImportOptions(f));

        if (imported instanceof FolderItem) {
            var items = bd_collectAll(imported, []);
            for (var i = 0; i < items.length; i++) {
                if ((items[i] instanceof CompItem) && items[i].usedIn.length === 0) {
                    names.push(items[i].name);

                    // The file is open anyway, so this is the cheap moment to
                    // grab a thumbnail from each comp.
                    if (previewDir) {
                        bd_previewPng(items[i], previewDir + "/" + items[i].name + ".png", 256);
                    }
                }
            }
            imported.remove();            // names were all we needed
        } else if (imported instanceof CompItem) {
            names.push(imported.name);
            if (previewDir) {
                bd_previewPng(imported, previewDir + "/" + imported.name + ".png", 256);
            }
            imported.remove();
        }
    } catch (e) {
        err = e.toString();
    }

    if (err) return "Error: " + err;
    if (!names.length) return "Error: no compositions found in that file.";
    return "OK:" + names.join("|");
}

/* Moves anything the panel imported previously into the current structure. */
function bd_tidy(folderSpec) {

    bd_setFolders(folderSpec);

    var err = null, moved = 0;
    app.beginUndoGroup("DVMotion - Tidy project");
    try {
        var root = bd_dest("root");
        var olds = [];
        for (var i = 1; i <= app.project.rootFolder.numItems; i++) {
            var it = app.project.rootFolder.item(i);
            if (it instanceof FolderItem && it !== root && it.name.indexOf("DVMotion") === 0) olds.push(it);
        }

        for (var k = 0; k < olds.length; k++) {
            var isCTA = (olds[k].name.indexOf("CTA") !== -1);
            var items = bd_collectAll(olds[k], []);
            var isMain = [];
            for (i = 0; i < items.length; i++) {
                isMain[i] = (items[i] instanceof CompItem) && (items[i].usedIn.length === 0);
            }
            for (i = 0; i < items.length; i++) {
                if (items[i] instanceof FootageItem) items[i].parentFolder = bd_dest(isCTA ? "cta" : "precomps");
                else if (isMain[i]) items[i].parentFolder = bd_dest("titles");
                else items[i].parentFolder = bd_dest("precomps");
                moved++;
            }
            bd_pruneEmpty(olds[k]);
        }
    } catch (e) {
        err = e.toString();
    }
    app.endUndoGroup();

    if (err) return "Error: " + err;
    return "OK:" + (moved ? (moved + " items tidied into '" + BD_F.root + "'.") : "Nothing to tidy.");
}

/* FALLBACK: copyToComp(). Only used if the native paste does nothing.
   Where the copy lands is not guaranteed, so we tag the existing layers
   and after each copy look for the one without a tag. */
function bd_unpackCopyToComp(src, target, offset, anchor) {

    var TAG = "###BD_KEEP###";
    var n = src.numLayers;
    var i, j;

    // 1. Tag every layer already in the target comp
    var oldComments = [];
    for (i = 1; i <= target.numLayers; i++) {
        oldComments.push(target.layer(i).comment);
        target.layer(i).comment = TAG;
    }

    // 2. Copy one at a time and find the untagged newcomer
    var map = [];
    var newComments = [];
    for (i = 1; i <= n; i++) {
        src.layer(i).copyToComp(target);

        var found = null;
        for (j = 1; j <= target.numLayers; j++) {
            if (target.layer(j).comment !== TAG) { found = target.layer(j); break; }
        }
        if (!found) throw new Error("Could not identify the copied layer (" + i + "/" + n + ").");

        map[i] = found;
        newComments[i] = found.comment;
        found.comment = TAG;
    }

    // 3. Remove the tags. The existing layers kept their order,
    //    so their comments can be restored in sequence.
    for (i = 1; i <= n; i++) map[i].comment = newComments[i];
    var c = 0;
    for (i = 1; i <= target.numLayers; i++) {
        if (target.layer(i).comment === TAG) target.layer(i).comment = oldComments[c++];
    }

    // 4. Order: raise from the bottom up so the source order survives
    for (i = n; i >= 1; i--) map[i].moveToBeginning();
    if (anchor) { var block = []; for (i = 1; i <= n; i++) block.push(map[i]); bd_placeAbove(block, anchor); }

    // 5. Parenting. Values are already relative, so we need the jump variant.
    for (j = 1; j <= n; j++) {
        var sp = src.layer(j).parent;
        if (sp && map[sp.index]) {
            try { map[j].setParentWithJump(map[sp.index]); }
            catch (e) { map[j].parent = map[sp.index]; }
        }
    }

    // 6. Shift to the CTI and select
    bd_deselectAll(target);
    for (i = 1; i <= n; i++) {
        if (offset) map[i].startTime = map[i].startTime + offset;
        map[i].selected = true;
    }
    return n;
}

/* Runs a menu command by name, falling back to its numeric id */
function bd_cmd(name, fallbackId) {
    var id = 0;
    try { id = app.findMenuCommandId(name); } catch (e) { id = 0; }
    if (!id) id = fallbackId;
    if (!id) throw new Error("Menu command not found: " + name);
    app.executeCommand(id);
}

/* PRIMARY: After Effects' own Copy/Paste.
   Keeps layer order, parenting, effects and keyframes intact. */
function bd_unpackInto(src, target, offset, anchor) {

    if (src.numLayers === 0) throw new Error("'" + src.name + "' is empty.");

    var before = target.numLayers;
    var i;

    /* Menu commands act on whatever panel has focus. Called from a CEP panel
       the focus is on the panel itself, so Copy can quietly copy nothing and
       Paste can quietly paste nothing - which is exactly why the first attempt
       after launching After Effects used to fail, and why pressing Ctrl+Z (which
       moves focus back to the main window) made it start working.
       app.activate() puts the focus where it belongs. */
    try { app.activate(); } catch (eA) {}

    // 1. Open the source comp and select every layer
    src.openInViewer();
    for (i = 1; i <= src.numLayers; i++) src.layer(i).selected = true;
    bd_cmd("Copy", 18);

    // 2. Return to the target comp and paste at the CTI
    target.openInViewer();
    target.time = offset;
    bd_deselectAll(target);
    bd_cmd("Paste", 19);

    var added = target.numLayers - before;

    // 3. Nothing landed - reclaim focus and try the paste once more
    if (added === 0) {
        try { app.activate(); } catch (eB) {}
        target.openInViewer();
        target.time = offset;
        bd_cmd("Paste", 19);
        added = target.numLayers - before;
    }

    // 4. Still nothing - fall back to copyToComp()
    if (added === 0) {
            try {
            return bd_unpackCopyToComp(src, target, offset, anchor);
        } catch (eD) {
            throw new Error("Could not copy the layers. Click once in the timeline " +
                            "so After Effects has focus, then try again.");
        }
    }

    if (added !== src.numLayers) {
        throw new Error("Incomplete paste: " + added + "/" + src.numLayers +
                        " layers. Press Ctrl+Z.");
    }

    // 5. Move above the selected layer, otherwise paste lands on top
    bd_placeAbove(target.selectedLayers, anchor);
    return added;
}

/* Titles are inserted in TWO separate evalScript calls.

   After Effects refuses to copy a layer that has a parent or a linked
   expression while an undo group from the same script evaluation is still on
   the stack. Importing the .aep and pasting its layers therefore cannot happen
   in one call - on a fresh launch the paste fails, and it only appears to
   "fix itself" later because the import is already in the project and gets
   skipped. Step 1 imports, step 2 places. */

/* Step 1 - import only. Returns "<target comp id>|<resolved comp name>".

   The target is locked in here, while the user's own composition is still the
   active one. Step 2 must not guess it again: pasting opens the title in a
   viewer, so by then the active item may well be the title itself. */
function bd_prepareTitle(aepPath, compName, kind, folderSpec) {

    bd_setFolders(folderSpec);
    var target = app.project.activeItem;
    if (!target || !(target instanceof CompItem)) return "No active composition.";
    var targetId = target.id;

    /*  No undo group around this. Importing a .aep runs After Effects' own
        undo handling, and wrapping that in a group of ours is what produced
        "Undo group mismatch, will attempt to fix" on every single import.
        The import is undoable on its own. */
    var err = null, name = null;
    try {
        var src = bd_getTitleComp(aepPath, compName, kind);
        name = src.name;
        if (src.id === targetId) {
            err = "that title is the composition you are in - open your own comp first";
        }
    } catch (e) {
        err = e.toString();
    }

    return err ? ("Error: " + err) : ("OK:" + targetId + "|" + name);
}

/* ---------- MATCH THE PROJECT ---------- */

/* Sets the frame rate on a comp and on every comp nested inside it. */
function bd_matchFps(comp, fps, seen) {
    if (!comp || !(comp instanceof CompItem) || !fps || fps <= 0) return 0;
    seen = seen || {};
    if (seen["c" + comp.id]) return 0;
    seen["c" + comp.id] = true;

    var n = 0;
    if (Math.abs(comp.frameRate - fps) > 0.001) { comp.frameRate = fps; n++; }

    for (var i = 1; i <= comp.numLayers; i++) {
        var src = null;
        try { src = comp.layer(i).source; } catch (e) { src = null; }
        if (src && (src instanceof CompItem)) n += bd_matchFps(src, fps, seen);
    }
    return n;
}

/* Uniform factor that fits src inside target, 1 when they already match. */
function bd_fitScale(src, target) {
    if (!src.width || !src.height) return 1;
    var kw = target.width / src.width;
    var kh = target.height / src.height;
    return Math.min(kw, kh);
}

/* Step 2 - place a composition that is already in the project.
   targetId comes from step 1 so the destination cannot drift. */
function bd_placeTitle(targetId, compName, unpack, folderSpec, matchFps, matchSize, collapse, dupe) {

    bd_setFolders(folderSpec);
    var target = null;
    if (targetId) { try { target = app.project.itemByID(parseInt(targetId, 10)); } catch (e0) {} }
    if (!target || !(target instanceof CompItem)) target = app.project.activeItem;
    if (!target || !(target instanceof CompItem)) return "No active composition.";

    var src = bd_findImported(compName) || bd_findComp(compName);
    if (!src) return "'" + compName + "' is not in the project. Try again.";
    if (src.id === target.id) {
        return "Error: that title is the composition you are in - open your own comp first.";
    }

    /*  A composition placed twice is the same composition twice: edit the text
        in one and it changes in the other. For anything carrying its own text
        that is wrong, so each insert gets its own copy. */
    if (dupe) {
        try {
            var parent = src.parentFolder;
            src = src.duplicate();
            src.parentFolder = parent;
        } catch (eD) { /* keep the original if duplicating fails */ }
    }

    var anchor = bd_topSelected(target);

    /* Frame rate is a property of the composition itself, so it is matched
       before anything is placed - nested precomps included. */
    var note = "";
    if (matchFps) {
        var changed = bd_matchFps(src, target.frameRate, {});
        if (changed) note += " " + target.frameRate + " fps";
    }

    var k = bd_fitScale(src, target);
    var sized = matchSize && Math.abs(k - 1) > 0.001;
    if (!matchSize && (src.width !== target.width || src.height !== target.height)) {
        note += " (size mismatch: " + src.width + "x" + src.height + ")";
    }
    var size = note;

    if (unpack) {
        // No undo group here - see the note above.
        try {
            var n = bd_unpackInto(src, target, target.time, anchor);
            return "OK:" + src.name + " - " + n + " layers added." + size;
        } catch (e1) {
            return "Error: " + e1.toString();
        }
    }

    // Precomp mode does not copy anything, so an undo group is safe here.
    // It is opened and closed on every path, including failure.
    var err = null, out = "";
    app.beginUndoGroup("DVMotion - Title");
    try {
        var layer = target.layers.add(src);
        layer.startTime = target.time;

        /* A 1080 title in a 4K comp is scaled up rather than resized, so the
           composition and everything expression-driven inside it stay intact.
           Collapse transformations keeps shapes and text sharp at any factor. */
        if (sized) {
            layer.property("ADBE Transform Group").property("ADBE Scale")
                 .setValue([k * 100, k * 100, 100]);
            note += " scaled to " + Math.round(k * 100) + "%";
        }
        if (collapse) { try { layer.collapseTransformation = true; } catch (eC) {} }

        if (anchor) { try { layer.moveBefore(anchor); } catch (e2) {} }
        bd_deselectAll(target);
        layer.selected = true;
        out = "OK:" + src.name + " added as a precomp." + note;
    } catch (e3) {
        err = e3.toString();
    }
    app.endUndoGroup();

    return err ? ("Error: " + err) : out;
}

/* ---------- CTA (video clips) ---------- */

/* Is this file already in the project? */
function bd_findFootage(file) {
    for (var i = 1; i <= app.project.numItems; i++) {
        var it = app.project.item(i);
        if (!(it instanceof FootageItem)) continue;
        var src = it.mainSource;
        if (src && (src instanceof FileSource) && src.file && src.file.fsName === file.fsName) return it;
    }
    return null;
}

/* offsetY - pixels below centre. scalePct - 0 means fit to the comp width. */
function bd_insertCTA(path, offsetY, scalePct, folderSpec) {

    bd_setFolders(folderSpec);
    var target = app.project.activeItem;
    if (!target || !(target instanceof CompItem)) return "No active composition.";

    var f = new File(path);
    if (!f.exists) return "File not found: " + path;

    var anchor = bd_topSelected(target);
    var err = null, msg = "";

    app.beginUndoGroup("DVMotion - CTA");
    try {
        var item = bd_findFootage(f);
        if (!item) {
            // Footage import, not a project import - safe inside the group
            item = app.project.importFile(new ImportOptions(f));
            item.parentFolder = bd_dest("cta");
        }

        var L = target.layers.add(item);
        var tr = L.property("ADBE Transform Group");

        // A still has no source duration - fall back to the layer's own length
        var clipDur = item.duration;
        if (!clipDur || clipDur <= 0) clipDur = L.outPoint - L.inPoint;
        if (!clipDur || clipDur <= 0) clipDur = target.duration;

        // Scale to the comp width (2160 -> 1080 = 50%)
        var s = scalePct;
        if (!s || s <= 0) s = (target.width / item.width) * 100;
        tr.property("ADBE Scale").setValue([s, s, 100]);

        // Centre, then push down
        tr.property("ADBE Position").setValue([target.width / 2, target.height / 2 + (offsetY || 0)]);

        // Snap to the end of the timeline
        var st = target.duration - clipDur;
        if (st < 0) st = 0;
        L.startTime = st;

        if (anchor) { try { L.moveBefore(anchor); } catch (e1) {} }
        bd_deselectAll(target);
        L.selected = true;

        msg = item.name + " - placed at the end, " + (Math.round(s * 10) / 10) + "%";
        if (st === 0 && clipDur > target.duration) {
            msg += " (CTA is longer than the composition)";
        }
    } catch (e) {
        err = e.toString();
    }
    app.endUndoGroup();

    return err ? ("Error: " + err) : ("OK:" + msg);
}

/* ---------- RENDER ---------- */

/*  Collects everything aerender needs. The project has to exist on disk, so an
    unsaved project is refused rather than guessed at.

    Returns  aerender | project | comp | frames | outDir  */
function bd_renderInfo(outDirZ) {


    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";

    var proj = app.project.file;
    if (!proj) return "Save the project first - aerender renders from disk.";

    if (app.project.dirty) {
        try { app.project.save(); }
        catch (e) { return "Could not save the project: " + e.toString(); }
    }

    // aerender sits next to the application executable on both platforms
    var exe = Folder.startup.fsName + "/aerender";
    if ($.os.indexOf("Windows") !== -1) exe += ".exe";
    if (!File(exe).exists) return "aerender not found at " + exe;

    var frames = Math.round(comp.duration * comp.frameRate);
    if (frames < 1) frames = 1;

    var outDir = outDirZ;
    if (!outDir) outDir = proj.parent.fsName + "/renders";

    // fsName uses backslashes on Windows; mixing them with the slashes we
    // append works, but it makes every log line harder to read.
    outDir = outDir.replace(/\\/g, "/").replace(/\/+$/, "");

    var f = Folder(outDir);
    if (!f.exists) f.create();

    return "OK:" + exe + "|" + proj.fsName + "|" + comp.name + "|" +
           frames + "|" + outDir + "|" + comp.frameRate;
}

/* ---------- PRESETS (.ffx) ---------- */

function bd_apply(pathIn, pathOut, mode, dur, addMarkers, markerMode, controls) {

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) return "No active composition.";

    // remember the selection
    var startSel = comp.selectedLayers;
    if (startSel.length === 0) return "No layer selected.";

    var targets = [];
    for (var i = 0; i < startSel.length; i++) {
        if (startSel[i] instanceof TextLayer) targets.push(startSel[i]);
    }
    if (targets.length === 0) return "None of the selected layers is a text layer.";

    var fIn  = pathIn  ? new File(pathIn)  : null;
    var fOut = pathOut ? new File(pathOut) : null;
    var hasIn  = !!(fIn  && fIn.exists);
    var hasOut = !!(fOut && fOut.exists);

    if (!hasIn && !hasOut) return "Preset file not found: " + (pathIn || pathOut);
    if (mode === "in"  && !hasIn)  return "IN preset not found: " + pathIn;
    if (mode === "out" && !hasOut) return "OUT preset not found: " + pathOut;

    if (!dur || dur <= 0) dur = 1;
    if (!markerMode) markerMode = mode;

    var oldTime = comp.time;
    var done = 0;
    var made = [];
    var err = null;

    app.beginUndoGroup("DVMotion - Text Anim");
    try {
        for (var k = 0; k < targets.length; k++) {
            var L = targets[k];

            // Sliders and markers go in first, so the preset's expressions
            // resolve the moment it lands.
            var mk2 = bd_addControls(L, controls);
            for (var q = 0; q < mk2.length; q++) {
                var dup = false;
                for (var r = 0; r < made.length; r++) if (made[r] === mk2[q]) { dup = true; break; }
                if (!dup) made.push(mk2[q]);
            }

            if (addMarkers) {
                if (markerMode === "in"  || markerMode === "both") bd_setMarker(L, bd_markTimeIn(L, dur), "IN");
                if (markerMode === "out" || markerMode === "both") bd_setMarker(L, bd_markTimeOut(L, dur), "OUT");
            }

            if (hasIn  && (mode === "in"  || mode === "both")) bd_applyAt(comp, L, fIn, L.inPoint);
            if (hasOut && (mode === "out" || mode === "both")) bd_applyAt(comp, L, fOut, bd_markTimeOut(L, dur));
            done++;
        }
    } catch (e) {
        err = e.toString();
    }
    app.endUndoGroup();

    // restore state
    comp.time = oldTime;
    bd_deselectAll(comp);
    for (var m = 0; m < targets.length; m++) targets[m].selected = true;

    if (err) return "Error: " + err;

    var label = (mode === "both") ? "IN + OUT" : mode.toUpperCase();
    var mk = addMarkers ? ((markerMode === "both") ? " + IN/OUT markers"
                                                   : " + " + markerMode.toUpperCase() + " marker") : "";
    var sl = made.length ? " + sliders: " + made.join(", ") : "";
    return "OK:" + done + " text layer(s): " + label + " applied" + mk + sl + ".";
}
