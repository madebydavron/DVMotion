/*  mtproto.js  -  uploading through your own Telegram account

    A bot may upload 50 MB, and no setting changes that: it is Telegram's
    limit on the Bot API, not ours. An ordinary account may upload 2 GB
    (4 GB with Premium), which is what this uses.

    That means signing in as you, not as a bot. The session string this
    produces is full access to your account - it lives in settings.json, in
    plain text, and should be treated like a password.

    api_id and api_hash come from my.telegram.org. These are the credentials
    that were doing nothing while only a bot was involved.
*/

var BDMT = (function () {

  var Telegram = null, StringSession = null, Api = null;

  try {
    var lib = require('teleproto');
    Telegram = lib.TelegramClient;
    Api = lib.Api;
    StringSession = require('teleproto/sessions').StringSession;
  } catch (e) { /* library missing - reported below */ }

  var client = null;       // signed-in client, reused between sends
  var pending = null;      // half-finished login: client + phone + code hash

  /*  What Telegram shows under Devices. Without these the session is listed as
      a bare "Windows_NT / 1.0", which tells you nothing when you are looking at
      a list of five sessions trying to work out which is which. */
  var ident = { device: 'DVMotion', version: '1.0' };

  function describe(device, version) {
    if (device)  ident.device  = device;
    if (version) ident.version = version;
  }

  function systemVersion() {
    try {
      var os = require('os');
      return os.type() + ' ' + os.release();
    } catch (e) { return 'unknown'; }
  }

  function available() { return !!Telegram; }

  function makeClient(apiId, apiHash, session) {
    return new Telegram(new StringSession(session || ''),
                        parseInt(apiId, 10), String(apiHash),
                        {
                          connectionRetries: 3,
                          useWSS: false,
                          deviceModel:   ident.device,
                          systemVersion: systemVersion(),
                          appVersion:    ident.version,
                          langCode:      'en'
                        });
  }

  // ------------------------------------------------------------ sign in

  /* Step one: connect and ask Telegram to send the code. */
  function sendCode(apiId, apiHash, phone, cb) {
    if (!available()) return cb('teleproto is missing from node_modules.');
    if (!apiId || !apiHash) return cb('api_id and api_hash are both needed.');
    if (!phone) return cb('Phone number is needed, with the country code.');

    var c = makeClient(apiId, apiHash, '');

    c.connect()
      .then(function () {
        return c.sendCode({ apiId: parseInt(apiId, 10), apiHash: String(apiHash) },
                          phone);
      })
      .then(function (res) {
        pending = { client: c, phone: phone, hash: res.phoneCodeHash,
                    apiId: apiId, apiHash: apiHash };
        cb(null);
      })
      .catch(function (e) { cb(String(e && e.message ? e.message : e)); });
  }

  /* Step two: the code, and the 2FA password if the account has one.
     Returns the session string to store. */
  function signIn(code, password, cb) {
    if (!pending) return cb('Ask for the code first.');

    var c = pending.client;

    c.invoke(new Api.auth.SignIn({
      phoneNumber:   pending.phone,
      phoneCodeHash: pending.hash,
      phoneCode:     String(code)
    }))
      .then(function () { done(); })
      .catch(function (e) {
        var msg = String(e && e.message ? e.message : e);

        // Two-factor accounts land here, and the password finishes the job
        if (msg.indexOf('SESSION_PASSWORD_NEEDED') !== -1) {
          if (!password) return cb('This account has two-step verification - enter the password.');

          c.signInWithPassword(
            { apiId: parseInt(pending.apiId, 10), apiHash: String(pending.apiHash) },
            { password: function () { return Promise.resolve(password); },
              onError:  function (err) { cb(String(err)); } })
            .then(function () { done(); })
            .catch(function (err) { cb(String(err && err.message ? err.message : err)); });
          return;
        }
        cb(msg);
      });

    function done() {
      client = c;
      var session = c.session.save();
      pending = null;
      cb(null, session);
    }
  }

  /* Reconnects with a stored session, so signing in happens once. */
  function resume(apiId, apiHash, session, cb) {
    if (!available()) return cb('teleproto is missing from node_modules.');
    if (!session) return cb('Not signed in yet.');

    if (client && client.connected) return cb(null);

    var c = makeClient(apiId, apiHash, session);
    c.connect()
      .then(function () { return c.isUserAuthorized(); })
      .then(function (ok) {
        if (!ok) return cb('The stored session is no longer valid - sign in again.');
        client = c;
        cb(null);
      })
      .catch(function (e) { cb(String(e && e.message ? e.message : e)); });
  }

  // ------------------------------------------------------------ sending

  /* target: "me" for Saved Messages, "@name", or a numeric id */
  function target(t) {
    t = (t || 'me').trim();
    if (t === '' || t.toLowerCase() === 'me') return 'me';
    if (/^-?\d+$/.test(t)) return parseInt(t, 10);
    return t;
  }

  function sendMessage(to, text, cb) {
    if (!client) return cb('Not connected.');
    client.sendMessage(target(to), { message: text })
      .then(function (m) { cb(null, m.id); })
      .catch(function (e) { cb(String(e && e.message ? e.message : e)); });
  }

  function editMessage(to, id, text, cb) {
    if (!client || !id) return cb && cb('Not connected.');
    client.editMessage(target(to), { message: id, text: text })
      .then(function () { cb && cb(null); })
      .catch(function () { cb && cb(null); });   // an edit that fails is not worth stopping for
  }

  function sendFile(to, filePath, caption, onProgress, cb) {
    if (!client) return cb('Not connected.');

    client.sendFile(target(to), {
      file: filePath,
      caption: caption || '',
      supportsStreaming: true,
      progressCallback: function (p) {
        if (onProgress) onProgress(Math.floor((p || 0) * 100));
      }
    })
      .then(function () { cb(null); })
      .catch(function (e) { cb(String(e && e.message ? e.message : e)); });
  }

  function connected() { return !!(client && client.connected); }

  return {
    available: available,
    describe: describe,
    sendCode: sendCode,
    signIn: signIn,
    resume: resume,
    sendMessage: sendMessage,
    editMessage: editMessage,
    sendFile: sendFile,
    connected: connected
  };
})();
