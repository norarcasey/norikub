/*
  A `blob:` link's bytes and name, read for the shell so it can open the file in a Mac app.

  Injected at documentStart into the page's own world by `Shell.swift`, as `print.js` is: a
  blob URL belongs to the document that made it, so only the page can read one. Hence
  `globalThis` for every global, which is also what lets `open.test.ts` supply one.

  WHY (Linora, `LIN/LIN-89`, 16 Nov 2026): a page that shows a file it fetched with a token has
  only a blob URL to link to. A browser opens that in a tab; this window has no tabs, and
  macOS, handed the URL, has no app for the `blob:` scheme at all ("There is no application
  set to open the URL blob:…"), so Choose Application… can pick nothing. The shell asks here
  for the bytes instead, writes them to a file and opens that.

  NO FETCH. The first version read the blob with `fetch(url)`, and in the window it failed with
  "TypeError: Load failed": Linora's content security policy has no `connect-src`, so
  `default-src 'self'` governs a fetch and a `blob:` URL is not `'self'`. Measured in a probe
  WKWebView under that policy (16 Nov 2026). So the Blob is kept as the page makes its URL —
  this runs before any of the page's code — and read directly, which no policy governs. It is
  dropped when the page revokes the URL, so it lives exactly as long as the URL does. `fetch`
  stays only for a blob made before this ran, which at documentStart is none in practice.

  The name is what the link calls the file: its `download` attribute, else the alt text of the
  image it wraps, else its own text. The shell adds an extension from the type when the name
  has none. Nothing here decides whether to open: the shell calls `read` for a link the person
  pressed, and only for a blob URL.
*/
(function (global) {
  'use strict';

  // The same name as `Opening.namespace` in Open.swift; `bundle.test.ts` compares them.
  var NAMESPACE = '__shellOpen';

  // `String.fromCharCode.apply` takes its bytes as arguments; past ~64k of them an engine may
  // refuse the call, so a file is turned into text a slice at a time.
  var SLICE = 0x8000;

  // Every Blob the page has a live URL for, by that URL.
  var made = new Map();
  var Url = global.URL;
  if (Url && typeof Url.createObjectURL === 'function') {
    var create = Url.createObjectURL;
    var revoke = Url.revokeObjectURL;
    Url.createObjectURL = function (object) {
      var url = create.call(Url, object);
      // A MediaSource has a URL too, and no bytes to open.
      if (global.Blob && object instanceof global.Blob) made.set(url, object);
      return url;
    };
    Url.revokeObjectURL = function (url) {
      made.delete(String(url));
      return revoke.call(Url, url);
    };
  }

  function linkTo(url) {
    var doc = global.document;
    var links = doc ? doc.querySelectorAll('a[href]') : [];
    for (var i = 0; i < links.length; i += 1) {
      if (links[i].href === url) return links[i];
    }
    return null;
  }

  function called(link) {
    if (!link) return '';
    var download = link.getAttribute('download');
    if (download) return download;
    var image = link.querySelector('img');
    var alt = image ? image.getAttribute('alt') : '';
    if (alt) return alt;
    return (link.textContent || '').trim();
  }

  function base64(buffer) {
    var bytes = new Uint8Array(buffer);
    var text = [];
    for (var i = 0; i < bytes.length; i += SLICE) {
      text.push(String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE)));
    }
    return global.btoa(text.join(''));
  }

  /** `{ name, type, data }` with `data` in base64, or null for a URL that is not a blob. */
  function read(url) {
    if (!/^blob:/.test(String(url))) return Promise.resolve(null);
    var name = called(linkTo(url));
    var kept = made.get(String(url));
    var found = kept
      ? Promise.resolve(kept)
      : global.fetch(url).then(function (response) {
          return response.blob();
        });
    return found.then(function (blob) {
      return blob.arrayBuffer().then(function (buffer) {
        return { name: name, type: blob.type, data: base64(buffer) };
      });
    });
  }

  global[NAMESPACE] = { read: read };
})(globalThis);
