/*  render.js  -  aerender + Telegram

    Rendering happens in aerender, not inside After Effects. app.project
    .renderQueue.render() blocks the whole application and reports nothing
    while it works; aerender runs as its own process and prints a PROGRESS
    line per frame, which is what makes a percentage possible at all.

    Needs Node, which the manifest already enables.
*/

var BDRender = (function () {

  var cp    = null;
  var https = null;
  var http  = null;
  var fs    = null;
  var path  = null;

  try {
    cp    = require('child_process');
    https = require('https');
    http  = require('http');
    fs    = require('fs');
    path  = require('path');
  } catch (e) { /* Node off - checked below */ }

  var DEFAULT_API = 'https://api.telegram.org';

  /*  Telegram's own servers cap a bot upload at 50 MB. A self-hosted Bot API
      server raises it to 2 GB, so the endpoint has to be configurable and the
      limit has to follow it. */
  function api(base) {
    base = (base || DEFAULT_API).replace(/\/+$/, '');

    var m = /^(https?):\/\/([^:/]+)(?::(\d+))?/i.exec(base);
    if (!m) return api(DEFAULT_API);

    var secure = (m[1].toLowerCase() === 'https');
    return {
      mod:      secure ? https : http,
      host:     m[2],
      port:     m[3] ? parseInt(m[3], 10) : (secure ? 443 : 80),
      official: base === DEFAULT_API,
      base:     base
    };
  }

  function limitFor(base, useAccount) {
    // Your own account: 2 GB. Your own Bot API server: 2 GB. A bot on
    // Telegram's servers: 50 MB, and nothing configurable changes that.
    if (useAccount) return 2000 * 1024 * 1024;
    return api(base).official ? 50 * 1024 * 1024 : 2000 * 1024 * 1024;
  }

  var proc = null;          // the running aerender, null when idle
  var logPath = null;

  /*  Everything the render does is written to render.log next to the
      extension. A failure that scrolls past in a toast is no use; a file you
      can open afterwards is. */
  function log(line) {
    if (!fs || !logPath) return;
    try {
      fs.appendFileSync(logPath,
        new Date().toISOString().slice(11, 19) + '  ' + line + '\n');
    } catch (e) {}
  }

  function setLogPath(p) { logPath = p; }

  // ---------------------------------------------------------- telegram

  function tgCall(token, method, payload, cb, base) {
    var a = api(base);
    var body = JSON.stringify(payload);
    var req = a.mod.request({
      host: a.host,
      port: a.port,
      path: '/bot' + token + '/' + method,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        var out = null;
        try { out = JSON.parse(data); } catch (e) {}
        if (cb) cb(out);
      });
    });
    req.on('error', function () { if (cb) cb(null); });
    req.write(body);
    req.end();
  }

  /*  multipart/form-data by hand. Telegram needs a real file upload and there
      is no form library here, so the body is assembled as buffers.

      The file is written chunk by chunk rather than piped, so the number of
      bytes sent is known and can be reported. A stalled upload is otherwise
      indistinguishable from a slow one.                                     */
  function tgUpload(token, chatId, filePath, caption, onProgress, cb, base) {
    var a = api(base);
    var boundary = '----BDForm' + Date.now();
    var name = path.basename(filePath);

    // Videos get a player in the chat, everything else goes as a document
    var isVideo = /\.(mp4|mov|m4v)$/i.test(name);
    var method  = isVideo ? 'sendVideo' : 'sendDocument';
    var field   = isVideo ? 'video' : 'document';

    function part(nm, val) {
      return Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="' + nm + '"\r\n\r\n' +
        val + '\r\n');
    }

    var head = Buffer.concat([
      part('chat_id', String(chatId)),
      part('caption', caption || ''),
      Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="' + field + '"; filename="' + name + '"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n')
    ]);
    var tail = Buffer.from('\r\n--' + boundary + '--\r\n');

    var size;
    try { size = fs.statSync(filePath).size; }
    catch (e) { cb(null, 'File not found: ' + filePath); return; }

    var done = false;
    function finish(res, err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(res, err);
    }

    // Telegram never closes a short request, it just waits. Without this an
    // upload that goes wrong looks exactly like one that is merely slow.
    var lastMove = Date.now();
    var sentBytes = 0;
    var timer = setInterval(function () {
      if (Date.now() - lastMove > 60000) {
        clearInterval(timer);
        try { req.destroy(); } catch (e) {}
        finish(null, 'Upload stalled after ' + Math.round(sentBytes / 1048576) +
                     ' of ' + Math.round(size / 1048576) +
                     ' MB - nothing accepted for a minute. ' +
                     'Usually the network blocking api.telegram.org.');
      }
    }, 5000);

    var req = a.mod.request({
      host: a.host,
      port: a.port,
      path: '/bot' + token + '/' + method,
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': head.length + size + tail.length
      }
    }, function (res) {
      var data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        clearInterval(timer);
        var out = null;
        try { out = JSON.parse(data); } catch (e) {}
        if (out && out.ok) finish(out, null);
        else finish(null, (out && out.description) ? out.description : data.slice(0, 200));
      });
    });

    req.on('error', function (e) {
      clearInterval(timer);
      finish(null, e.message);
    });

    req.write(head);

    var sent = 0;
    var stream = fs.createReadStream(filePath);

    stream.on('data', function (chunk) {
      sent += chunk.length;
      sentBytes = sent;
      lastMove = Date.now();

      if (!req.write(chunk)) {
        stream.pause();
        req.once('drain', function () { stream.resume(); });
      }
      if (onProgress) onProgress(sent, size);
    });

    stream.on('end', function () { req.end(tail); });
    stream.on('error', function (e) {
      clearInterval(timer);
      finish(null, e.message);
    });
  }

  /*  A bar Telegram can render in plain text. Twelve blocks, so one block is
      a little over 8% - fine enough to feel alive, coarse enough that the
      message is not edited on every single frame. */
  function bar(pct) {
    var n = 12;
    var full = Math.round(pct / 100 * n);
    if (full < 0) full = 0;
    if (full > n) full = n;

    var s = '';
    for (var i = 0; i < n; i++) s += (i < full) ? '\u2588' : '\u2591';
    return s + '  ' + pct + '%';
  }

  /*  aerender writes what the output module decides, not what we asked for.
      An H.264 template can land as .mov, a template with a file-name suffix
      can add its own. So if the exact path is missing, take the newest file in
      the folder whose name starts the same way. */
  function resolveOutput(dir, base, wanted, startedAt) {
    try { if (fs.statSync(wanted).size > 0) return wanted; } catch (e) {}

    var want = base.toLowerCase();
    var best = null, bestTime = 0, listed = [];

    try {
      var names = fs.readdirSync(dir);
      for (var i = 0; i < names.length; i++) {
        var full = dir + '/' + names[i];
        var st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (!st.isFile()) continue;

        listed.push(names[i] + ' (' + Math.round(st.size / 1024) + ' KB)');

        if (st.size === 0) continue;
        if (names[i].toLowerCase().indexOf(want) !== 0) continue;
        // ignore anything that predates this render
        if (startedAt && st.mtimeMs < startedAt - 5000) continue;

        if (st.mtimeMs > bestTime) { bestTime = st.mtimeMs; best = full; }
      }
    } catch (e) {
      log('could not read ' + dir + ': ' + e.message);
    }

    if (!best) log('folder contains: ' + (listed.length ? listed.join(', ') : '(empty)'));
    return best;
  }

  /*  Re-encodes to fit under the upload limit.

      api_id and api_hash on their own change nothing - they are credentials
      for a Bot API server you run yourself. Until that server exists, the cap
      is 50 MB, and the only thing that helps is a smaller file. */
  function haveFfmpeg(cb) {
    var p;
    try { p = cp.spawn('ffmpeg', ['-version']); }
    catch (e) { return cb(false); }
    p.on('error', function () { cb(false); });
    p.on('close', function (code) { cb(code === 0); });
  }

  function compress(inPath, outPath, seconds, limitBytes, onPct, cb) {
    // Leave a tenth for the container and audio, then split what is left
    var bits = limitBytes * 8 * 0.90;
    var kbps = Math.floor(bits / Math.max(1, seconds) / 1000) - 96;
    if (kbps < 300) kbps = 300;

    log('compressing to ~' + kbps + ' kbps for ' + seconds.toFixed(1) + ' s');

    var args = ['-y', '-i', inPath,
                '-c:v', 'libx264', '-preset', 'veryfast',
                '-b:v', kbps + 'k', '-maxrate', kbps + 'k',
                '-bufsize', (kbps * 2) + 'k',
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '96k',
                outPath];

    var p = cp.spawn('ffmpeg', args);
    var err = '';

    p.stderr.on('data', function (c) {
      var t = String(c);
      err = t;
      var m = /time=(\d+):(\d+):(\d+)/.exec(t);
      if (m && onPct) {
        var done = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        onPct(Math.min(99, Math.floor(done / Math.max(1, seconds) * 100)));
      }
    });

    p.on('error', function (e) { cb(e.message); });
    p.on('close', function (code) {
      if (code !== 0) return cb('ffmpeg exited with code ' + code + ': ' + err.slice(-200));
      cb(null);
    });
  }

  // ---------------------------------------------------------- render

  /*  opts: { aerender, project, comp, frames, outDir, omTemplate, rsTemplate,
             token, chatId }
      on:   { status(text), done(), fail(text) }                              */
  function start(opts, on) {

    if (!cp) return on.fail('Node is off. Add --enable-nodejs to the manifest.');
    if (proc) return on.fail('A render is already running.');

    /*  The extension is a guess and nothing more: the output module decides
        the real container. aerender is given a path without one so it can
        append whatever it actually writes, and the file is located afterwards
        by name rather than by assumption. */
    var safe = opts.comp.replace(/[\\/:*?"<>|]/g, '_');
    var out  = opts.outDir + '/' + safe;
    var startedAt = Date.now();

    var args = ['-project', opts.project, '-comp', opts.comp, '-output', out];
    if (opts.rsTemplate) args.push('-RStemplate', opts.rsTemplate);
    if (opts.omTemplate) args.push('-OMtemplate', opts.omTemplate);

    var msgId   = null;
    var lastBar = '';
    var lastAt  = 0;
    var failed  = null;

    function tg(text) {
      if (opts.useAccount) {
        if (msgId === null) {
          BDMT.sendMessage(opts.chatId, text, function (e, id) { if (!e) msgId = id; });
        } else {
          BDMT.editMessage(opts.chatId, msgId, text);
        }
        return;
      }
      if (!opts.token || !opts.chatId) return;
      if (msgId === null) {
        tgCall(opts.token, 'sendMessage',
               { chat_id: opts.chatId, text: text },
               function (r) { if (r && r.ok) msgId = r.result.message_id; },
               opts.apiBase);
      } else {
        tgCall(opts.token, 'editMessageText',
               { chat_id: opts.chatId, message_id: msgId, text: text },
               null, opts.apiBase);
      }
    }

    setLogPath(opts.logPath || null);
    log('--- render ' + opts.comp + ' ---');
    log('aerender: ' + opts.aerender);
    log('args: ' + args.join(' '));

    tg('Rendering  ' + opts.comp + '\n' + bar(0));
    on.status('Rendering ' + opts.comp + '  0%');

    try {
      proc = cp.spawn(opts.aerender, args);
    } catch (e) {
      log('spawn failed: ' + e.message);
      return on.fail('Could not start aerender: ' + e.message);
    }

    function read(chunk) {
      var text = String(chunk);

      // aerender prints one line per frame:
      //   PROGRESS:  0:00:00:04 (5): 0 Seconds
      var re = /PROGRESS:.*?\((\d+)\)/g, m, frame = null;
      while ((m = re.exec(text)) !== null) frame = parseInt(m[1], 10);

      if (/aerender ERROR|Error:/i.test(text)) failed = text.split('\n')[0];

      if (frame !== null) {
        var pct = Math.floor(frame / opts.frames * 100);
        if (pct > 100) pct = 100;
        on.status('Rendering ' + opts.comp + '  ' + pct + '%  (' +
                  frame + '/' + opts.frames + ')');

        // Telegram rate-limits edits. The message is only touched when the bar
        // itself would look different, and never more than once every 3
        // seconds - so roughly one edit per 8% of the render.
        var b = bar(pct);
        var now = Date.now();
        if (b !== lastBar && now - lastAt > 3000) {
          lastBar = b;
          lastAt  = now;
          tg('Rendering  ' + opts.comp + '\n' + b + '\n' +
             frame + ' / ' + opts.frames + ' frames');
        }
      }
    }

    proc.stdout.on('data', read);
    proc.stderr.on('data', read);

    proc.on('close', function (code) {
      proc = null;
      log('aerender exit code ' + code);

      if (code !== 0 || failed) {
        var why = failed || ('aerender exited with code ' + code +
                             ' - see render.log in the extension folder');
        log('FAILED: ' + why);
        tg('Render failed  ' + opts.comp + '\n' + why);
        return on.fail(why);
      }

      log('aerender finished, looking for the output file');

      var real = resolveOutput(opts.outDir, safe, out, startedAt);
      if (!real) {
        var why2 = 'aerender reported no error, but nothing starting with "' +
                   safe + '" was written to ' + opts.outDir +
                   '. See render.log for what the folder does contain.';
        log(why2);
        tg('Render finished but the file was not found\n' + opts.outDir);
        return on.fail(why2);
      }
      log('output file: ' + real);

      var size = 0;
      try { size = fs.statSync(real).size; } catch (e) {}

      var limit = limitFor(opts.apiBase, opts.useAccount);

      if (size > limit) {
        log('too large: ' + size + ' bytes, limit ' + limit);

        if (!opts.fit) {
          tg('Rendered  ' + opts.comp + '\n' +
             Math.round(size / 1048576) + ' MB - over the ' +
             Math.round(limit / 1048576) + ' MB limit.\n' + real);
          return on.done('Rendered. Too large to send (' +
                         Math.round(size / 1048576) + ' MB): ' + real);
        }

        return haveFfmpeg(function (ok) {
          if (!ok) {
            log('ffmpeg not on PATH');
            tg('Rendered  ' + opts.comp + '\n' +
               Math.round(size / 1048576) + ' MB - too large, and ffmpeg is not installed.');
            return on.done('Too large (' + Math.round(size / 1048576) +
                           ' MB) and ffmpeg is not on PATH: ' + real);
          }

          var small = real.replace(/\.[^.]+$/, '') + '_tg.mp4';
          var secs  = opts.frames / (opts.fps || 25);

          tg('Rendered  ' + opts.comp + '\nCompressing to fit ' +
             Math.round(limit / 1048576) + ' MB');

          compress(real, small, secs, limit,
            function (pct) { on.status('Compressing ' + opts.comp + '  ' + pct + '%'); },
            function (cerr) {
              if (cerr) {
                log('COMPRESS FAILED: ' + cerr);
                tg('Compression failed  ' + opts.comp);
                return on.fail('Compression failed: ' + cerr);
              }
              var newSize = 0;
              try { newSize = fs.statSync(small).size; } catch (e) {}
              log('compressed to ' + newSize + ' bytes');

              if (!newSize || newSize > limit) {
                return on.fail('Still too large after compression: ' + small);
              }
              upload(small, newSize);
            });
        });
      }

      upload(real, size);

      function upload(fileP, fileSize) {
      tg('Rendered  ' + opts.comp + '\n' + bar(100) + '\nUploading...');
      on.status('Uploading ' + fileP.replace(/^.*[\\/]/, ''));

      var mb = (fileSize / 1048576).toFixed(1);
      var lastUpBar = '';

      var shown = fileP.replace(/^.*[\\/]/, '');

      if (opts.useAccount) {
        log('uploading through the account: ' + shown + ' (' + mb + ' MB)');
        var lastAccBar = '';

        return BDMT.sendFile(opts.chatId, fileP, opts.comp,
          function (pct) {
            on.status('Uploading ' + shown + '  ' + pct + '%  (' + mb + ' MB)');
            var b2 = bar(pct), now2 = Date.now();
            if (b2 !== lastAccBar && now2 - lastAt > 3000) {
              lastAccBar = b2;
              lastAt = now2;
              tg('Uploading  ' + opts.comp + '\n' + b2 + '\n' + mb + ' MB');
            }
          },
          function (err) {
            if (err) {
              log('ACCOUNT UPLOAD FAILED: ' + err);
              return on.fail('Upload failed: ' + err);
            }
            log('uploaded ok');
            tg('Done  ' + opts.comp + '\n' + bar(100) + '\n' + mb + ' MB');
            on.done('Sent: ' + shown);
          });
      }

      tgUpload(opts.token, opts.chatId, fileP, opts.comp,
        function (sent, total) {
          var pct = Math.floor(sent / total * 100);
          on.status('Uploading ' + shown + '  ' + pct + '%  (' + mb + ' MB)');

          var b = bar(pct);
          var now = Date.now();
          if (b !== lastUpBar && now - lastAt > 3000) {
            lastUpBar = b;
            lastAt = now;
            tg('Uploading  ' + opts.comp + '\n' + b + '\n' + mb + ' MB');
          }
        },
        function (r, err) {
          if (err) {
            log('UPLOAD FAILED: ' + err);
            tg('Upload failed  ' + opts.comp + '\n' + err);
            on.fail('Upload failed: ' + err);
            return;
          }
          log('uploaded ok');
          tg('Done  ' + opts.comp + '\n' + bar(100) + '\n' + mb + ' MB');
          on.done('Sent to Telegram: ' + shown);
        }, opts.apiBase);
      }
    });

    proc.on('error', function (e) {
      proc = null;
      on.fail('Could not start aerender: ' + e.message);
    });
  }

  function cancel() {
    if (!proc) return false;
    try { proc.kill(); } catch (e) {}
    proc = null;
    return true;
  }

  function busy() { return !!proc; }

  /*  Sends one message and reports exactly what Telegram said. Worth having:
      it separates "the bot is misconfigured" from "the upload is blocked". */
  function test(token, chatId, cb, base) {
    if (!https) return cb('Node is off.');
    if (!token || !chatId) return cb('Bot token and chat ID are both needed.');

    tgCall(token, 'sendMessage',
           { chat_id: chatId, text: 'DVMotion: connection test' },
           function (r) {
             if (r && r.ok) cb(null);
             else cb(r && r.description ? r.description : 'No reply from ' + api(base).base);
           }, base);
  }

  /* Uploads render.log itself, for when the panel is on another machine. */
  function sendLog(token, chatId, filePath, cb, base) {
    if (!fs) return cb('Node is off.');
    if (!token || !chatId) return cb('Bot token and chat ID are both needed.');
    tgUpload(token, chatId, filePath, 'render.log', null,
             function (r, err) { cb(err || null); }, base);
  }

  return { start: start, cancel: cancel, busy: busy, test: test,
           sendLog: sendLog, limitFor: limitFor, hasNode: !!cp };
})();
