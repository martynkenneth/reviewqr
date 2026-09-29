// Small progressive enhancements. Every page works without this file; it just
// makes copying, sharing and previews nicer.
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // --- Offline support / installable app ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  function toast(text) {
    var old = $('.toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  function flash(btn, label) {
    var span = $('span', btn);
    var target = span || btn;
    var before = target.textContent;
    btn.classList.add('is-done');
    target.textContent = label;
    setTimeout(function () {
      btn.classList.remove('is-done');
      target.textContent = before;
    }, 1800);
  }

  $$('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      copyText(btn.getAttribute('data-copy')).then(
        function () { flash(btn, btn.getAttribute('data-copied') || 'Copied'); },
        function () { window.prompt('Copy this link:', btn.getAttribute('data-copy')); }
      );
    });
  });

  // --- Share screen ---
  var share = $('[data-share]');
  if (share) {
    var msg = $('[data-share-message]', share);
    var file = null;

    // Fetch the image up front: browsers only allow sharing straight after a
    // tap, and waiting for a download first would lose that.
    if (navigator.canShare && window.File) {
      fetch(share.getAttribute('data-file'), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.blob() : null; })
        .then(function (blob) {
          if (!blob) return;
          var f = new File([blob], share.getAttribute('data-filename'), { type: 'image/png' });
          if (navigator.canShare({ files: [f] })) file = f;
        })
        .catch(function () {});
    }

    var updateLinks = function () {
      var text = encodeURIComponent(msg.value);
      $$('[data-share-link]', share).forEach(function (a) {
        var kind = a.getAttribute('data-share-link');
        if (kind === 'whatsapp') a.href = 'https://wa.me/?text=' + text;
        if (kind === 'sms') a.href = 'sms:?&body=' + text;
        if (kind === 'email') a.href = a.href.replace(/body=[^&]*/, 'body=' + text);
      });
    };
    msg.addEventListener('input', updateLinks);

    var nativeBtn = $('[data-native-share]', share);
    if (!navigator.share) nativeBtn.hidden = true;
    nativeBtn.addEventListener('click', function () {
      var data = { title: share.getAttribute('data-title'), text: msg.value };
      if (file) data.files = [file];
      navigator.share(data).catch(function (err) {
        // If sharing the image isn't allowed, fall back to just the message.
        if (err && err.name !== 'AbortError' && data.files) {
          delete data.files;
          navigator.share(data).catch(function () {});
        }
      });
    });

    var copyMsg = $('[data-copy-message]', share);
    copyMsg.addEventListener('click', function () {
      copyText(msg.value).then(function () { flash(copyMsg, 'Message copied'); }, function () { msg.select(); });
    });
  }

  // --- Business form live preview ---
  var form = $('[data-business-form]');
  if (form) {
    var preview = $('[data-preview]', form);
    var nameIn = $('[data-preview-name]', form);
    var nameOut = $('[data-preview-name-out]', form);
    var logoIn = $('[data-logo-input]', form);
    var logoThumb = $('[data-logo-thumb]', form);
    var logoPrev = $('[data-preview-logo]', form);
    var removeLogo = $('[data-remove-logo]', form);
    var custom = $('[data-colour-custom]', form);
    var customRadio = $('[data-colour-custom-radio]', form);
    var urlIn = $('[data-google-url]', form);
    var testLink = $('[data-test-link]', form);

    var textOn = function (hex) {
      var n = parseInt(hex.slice(1), 16);
      var lum = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) {
        c /= 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      var L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
      return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.0592) ? '#ffffff' : '#111827';
    };
    var setColour = function (hex) {
      preview.style.setProperty('--brand', hex);
      preview.style.setProperty('--on-brand', textOn(hex));
    };
    var currentColour = function () {
      var checked = $('input[name="brand_colour"]:checked', form);
      if (!checked) return null;
      return checked.value === 'custom' ? custom.value : checked.value;
    };

    nameIn.addEventListener('input', function () { nameOut.textContent = nameIn.value.trim() || 'your business'; });
    $$('input[name="brand_colour"]', form).forEach(function (r) {
      r.addEventListener('change', function () { setColour(currentColour()); });
    });
    custom.addEventListener('input', function () { customRadio.checked = true; setColour(custom.value); });
    custom.addEventListener('click', function () { customRadio.checked = true; });
    if (currentColour()) setColour(currentColour());

    logoIn.addEventListener('change', function () {
      var f = logoIn.files && logoIn.files[0];
      if (!f) return;
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
        toast('Please choose a JPG, PNG or WebP image');
        logoIn.value = '';
        return;
      }
      if (f.size > 5 * 1024 * 1024) {
        toast('That image is over 5MB');
        logoIn.value = '';
        return;
      }
      var url = URL.createObjectURL(f);
      logoThumb.src = logoPrev.src = url;
      logoThumb.hidden = logoPrev.hidden = false;
      if (removeLogo) removeLogo.checked = false;
    });
    if (removeLogo) {
      removeLogo.addEventListener('change', function () { logoPrev.hidden = removeLogo.checked; });
    }

    var updateTest = function () {
      var v = urlIn.value.trim();
      var ok = /^(https?:\/\/)?[\w.-]*(g\.page|maps\.app\.goo\.gl|google\.[a-z.]+|g\.co)\//i.test(v);
      testLink.hidden = !ok;
      if (ok) testLink.href = /^https?:\/\//i.test(v) ? v : 'https://' + v;
    };
    urlIn.addEventListener('input', updateTest);
    updateTest();
  }

  // --- Show QR: keep the screen awake while the customer scans ---
  if ($('[data-wake-lock]') && 'wakeLock' in navigator) {
    var lock = null;
    var request = function () {
      navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
    };
    request();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !lock) request();
      if (document.visibilityState === 'hidden') lock = null;
    });
  }

  // --- Confirm dangerous actions ---
  $$('[data-confirm]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      if (!window.confirm(btn.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // --- Log out: wipe cached pages so the next person can't see them offline ---
  var logout = $('[data-logout]');
  if (logout && window.caches) {
    logout.addEventListener('submit', function (e) {
      e.preventDefault();
      caches.keys()
        .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
        .finally(function () { logout.submit(); });
    });
  }
})();
