/*
  Printing, inside the Mac shell: `window.print` forwarded to the shell, and the page's own
  `@page` rule read back for it.

  Injected at documentStart into the page's own world by `Shell.swift`, as `notify.js` is, so
  `globalThis` is the page's window, and `print.test.ts` can supply one.

  TWO THINGS A WKWebView DOES NOT DO, measured on macOS 26 (BINGO-7, 12 Oct 2026) with a probe
  window onto a scratch Bingora:

  1. `window.print` reaches only a private UI-delegate method,
     `_webView:printFrame:pdfFirstPageSize:completionHandler:`, which the probe saw fire. With
     no such delegate it does nothing, so the page's Print button was a button that did nothing.
     It is replaced here with a message to the shell, which is public and does not depend on a
     private method that a WebKit update could drop without a word.

  2. A print operation takes its paper, orientation and margins from the shell's NSPrintInfo
     and ignores `@page`. With the defaults (portrait Letter, inch margins) Bingora's landscape
     board lost its right column. With landscape Letter and no margins, what its stylesheet
     asks for, it printed whole on one sheet. So `page()` reads the rule the page set and the
     shell applies it. The paper stays the web app's decision: the shell does not know what is
     on the page.

  A rule this cannot read, such as `size: auto` or a percentage margin, comes back as null, and
  the shell leaves that setting at the printer's default. It never guesses at one.
*/
(function (global) {
  'use strict';

  // The same two names as `Printing.channel` and `Printing.namespace` in Print.swift;
  // `bundle.test.ts` reads both files and compares them.
  var CHANNEL = 'shellPrint';
  var NAMESPACE = '__shellPrint';

  var webkit = global.webkit;
  var handlers = webkit ? webkit.messageHandlers : null;
  var bridge = handlers ? handlers[CHANNEL] || null : null;

  // No channel means the shell did not register one. The engine's own print is left alone.
  if (!bridge) return;

  // Points per unit. A CSS px is 1/96 in, and a point is 1/72.
  var POINTS = { pt: 1, px: 0.75, in: 72, pc: 12, cm: 72 / 2.54, mm: 72 / 25.4, q: 72 / 101.6 };

  // The named sizes in CSS Paged Media, portrait, in points.
  var PAPERS = {
    a5: [419.53, 595.28],
    a4: [595.28, 841.89],
    a3: [841.89, 1190.55],
    b5: [498.9, 708.66],
    b4: [708.66, 1000.63],
    'jis-b5': [515.91, 728.5],
    'jis-b4': [728.5, 1031.81],
    letter: [612, 792],
    legal: [612, 1008],
    ledger: [792, 1224],
  };

  var SIDES = ['top', 'right', 'bottom', 'left'];

  function length(text) {
    var match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z]*)$/.exec(String(text).trim().toLowerCase());
    if (!match) return null;
    var value = Number(match[1]);
    if (match[2] === '') return value === 0 ? 0 : null;
    var unit = POINTS[match[2]];
    return unit === undefined || value < 0 ? null : value * unit;
  }

  /*
    `size` as the shell wants it: the paper as portrait width and height in points, or null for
    the printer's own, and whether it is landscape, or null where the rule did not say. Null
    for the whole value when the rule says nothing, or says something this does not read.
  */
  function size(text) {
    var tokens = String(text).trim().toLowerCase().split(/\s+/);
    if (tokens.length === 0 || tokens[0] === '' || tokens[0] === 'auto') return null;
    var named = null;
    var turned = null;
    var lengths = [];
    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i];
      if (token === 'landscape' || token === 'portrait') {
        if (turned !== null) return null;
        turned = token === 'landscape';
      } else if (Object.prototype.hasOwnProperty.call(PAPERS, token)) {
        if (named !== null) return null;
        named = PAPERS[token];
      } else {
        var points = length(token);
        if (points === null || points === 0) return null;
        lengths.push(points);
      }
    }
    if (lengths.length > 0) {
      // Lengths are the sheet as it is meant to be read, so they say the orientation too.
      if (named !== null || turned !== null || lengths.length > 2) return null;
      var wide = lengths[0];
      var tall = lengths.length === 2 ? lengths[1] : lengths[0];
      return {
        paper: { width: Math.min(wide, tall), height: Math.max(wide, tall) },
        landscape: wide > tall,
      };
    }
    return {
      paper: named === null ? null : { width: named[0], height: named[1] },
      landscape: turned,
    };
  }

  // A print rule: `print`, `all`, or no media at all. A `not` query is never one.
  function forPrint(media) {
    var text = media ? String(media.mediaText) : '';
    if (text.trim() === '') return true;
    return text.split(',').some(function (query) {
      return /^\s*(only\s+)?(print|all)\b/i.test(query);
    });
  }

  function rules(list, found) {
    for (var i = 0; i < list.length; i += 1) {
      var rule = list[i];
      // 6 is CSSRule.PAGE_RULE. A `:first` or `:left` rule is one sheet's, not every sheet's.
      if (rule.type === 6) {
        if (!rule.selectorText) found.push(rule.style);
      } else if (rule.cssRules && (rule.type !== 4 || forPrint(rule.media))) {
        // 4 is CSSRule.MEDIA_RULE; @supports and @layer have rules and no media.
        rules(rule.cssRules, found);
      }
    }
    return found;
  }

  /** The page's `@page` declarations in cascade order: a later one wins, side by side. */
  function page() {
    var found = [];
    var sheets = global.document ? global.document.styleSheets : [];
    for (var i = 0; i < sheets.length; i += 1) {
      var sheet = sheets[i];
      if (sheet.disabled || !forPrint(sheet.media)) continue;
      var list;
      try {
        list = sheet.cssRules;
      } catch {
        // Another origin's sheet cannot be read, and what it says is not guessed at.
        continue;
      }
      rules(list, found);
    }
    var result = { paper: null, landscape: null, margins: {} };
    for (var s = 0; s < SIDES.length; s += 1) result.margins[SIDES[s]] = null;
    for (var j = 0; j < found.length; j += 1) {
      var style = found[j];
      var said = size(style.getPropertyValue('size'));
      if (said !== null) {
        result.paper = said.paper;
        result.landscape = said.landscape;
      }
      for (var k = 0; k < SIDES.length; k += 1) {
        var side = style.getPropertyValue('margin-' + SIDES[k]);
        if (String(side).trim() !== '') result.margins[SIDES[k]] = length(side);
      }
    }
    return result;
  }

  Object.defineProperty(global, 'print', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function print() {
      bridge.postMessage({ kind: 'print' });
    },
  });

  // Where the shell reads the rule, when it is about to print.
  Object.defineProperty(global, NAMESPACE, {
    configurable: true,
    enumerable: false,
    value: { page: page },
  });
})(globalThis);
