/* webOS launch bootstrap.
 *
 * Fresh installs load ./app.js + ./app.css as normal files (webOS chokes on
 * injecting a ~1 MB inline <script> — SyntaxError / "Unexpected token" @ boot).
 * OTA updates from IndexedDB still inject { css, js } because the app dir is
 * read-only; if injection fails we wipe the bad stash and fall back to files. */
(function () {
  if (typeof globalThis === 'undefined') window.globalThis = window
  var baked = window.__BAKED__ || { version: '0.0.0' }
  var mounted = false
  var mountMode = 'none' // 'files' | 'inject'

  function cmp(a, b) {
    a = String(a || '0').replace(/^v/, '').split('.')
    b = String(b || '0').replace(/^v/, '').split('.')
    for (var i = 0; i < 3; i++) {
      var d = (parseInt(a[i], 10) || 0) - (parseInt(b[i], 10) || 0)
      if (d !== 0) return d > 0 ? 1 : -1
    }
    return 0
  }

  function setShell() {
    document.body.innerHTML =
      '<div id="root"></div>' +
      '<div id="boot-status" style="position:fixed;inset:0;display:flex;align-items:center;' +
      'justify-content:center;color:#9ca3af;font:500 22px/1.4 Georgia,serif;font-style:italic;' +
      'pointer-events:none;z-index:99998">Loading Finesse...</div>'
  }

  function mountFromFiles(version) {
    if (mounted) return
    mounted = true
    mountMode = 'files'
    try {
      window.__APP_VERSION__ = version || baked.version
      setShell()
      var link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = './app.css'
      document.head.appendChild(link)
      var script = document.createElement('script')
      script.src = './app.js'
      script.onerror = function () {
        mounted = false
        showError('Failed to load app.js from the package.')
      }
      document.body.appendChild(script)
      watchUiMount()
    } catch (e) {
      mounted = false
      showError('File mount failed: ' + (e && e.message ? e.message : e))
    }
  }

  function mountInjected(bundle) {
    if (mounted) return
    var b = bundle && bundle.js ? bundle : null
    if (!b || !b.js) {
      mountFromFiles(baked.version)
      return
    }
    mounted = true
    mountMode = 'inject'
    try {
      window.__APP_VERSION__ = b.version
      setShell()
      if (b.css) {
        var style = document.createElement('style')
        style.textContent = b.css
        document.head.appendChild(style)
      }
      var script = document.createElement('script')
      script.textContent = b.js
      script.onerror = function () {
        showError('OTA bundle failed to run; falling back to packaged app.')
        clearOta(function () {
          mounted = false
          mountFromFiles(baked.version)
        })
      }
      document.body.appendChild(script)
      watchUiMount()
    } catch (e) {
      mounted = false
      showError('Inject mount failed: ' + (e && e.message ? e.message : e))
      clearOta(function () { mountFromFiles(baked.version) })
    }
  }

  function watchUiMount() {
    setTimeout(function () {
      var root = document.getElementById('root')
      if (root && !root.childNodes.length) {
        showError('App ran but UI did not mount.')
      }
    }, 8000)
  }

  function clearOta(done) {
    try {
      if (typeof indexedDB === 'undefined') { done(); return }
      var req = indexedDB.open('finesse-ota', 1)
      req.onsuccess = function () {
        try {
          var tx = req.result.transaction('kv', 'readwrite')
          tx.objectStore('kv').delete('bundle')
          tx.oncomplete = function () { done() }
          tx.onerror = function () { done() }
        } catch (e) { done() }
      }
      req.onerror = function () { done() }
    } catch (e) { done() }
  }

  function showError(msg) {
    try {
      var status = document.getElementById('boot-status')
      if (status && status.parentNode) status.parentNode.removeChild(status)
      var d = document.getElementById('boot-err')
      if (!d) {
        d = document.createElement('div')
        d.id = 'boot-err'
        d.style.cssText =
          'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
          'background:rgba(11,13,18,0.92);color:#ffb4b4;font:18px/1.5 monospace;padding:32px;' +
          'white-space:pre-wrap;text-align:center;'
        ;(document.body || document.documentElement).appendChild(d)
      }
      d.textContent += 'Finesse boot error:\n' + msg + '\n'
    } catch (e) { /* nothing else we can do */ }
  }

  function formatErr(e) {
    var msg = e && e.message ? e.message : 'script error'
    if (e && e.lineno) msg += ' @' + e.lineno
    if (e && e.colno) msg += ':' + e.colno
    return msg
  }

  window.addEventListener('error', function (e) {
    showError(formatErr(e))
    // Bad OTA stash can brick every launch — drop it and reload from disk files.
    if (
      mountMode === 'inject' &&
      e &&
      e.message &&
      /unexpected|syntax/i.test(e.message)
    ) {
      clearOta(function () {
        var root = document.getElementById('root')
        if (!root || !root.childNodes.length) {
          mounted = false
          mountMode = 'none'
          mountFromFiles(baked.version)
        }
      })
    }
  })
  window.addEventListener('unhandledrejection', function (e) {
    showError('promise: ' + (e && e.reason ? (e.reason.message || e.reason) : 'rejected'))
  })

  try {
    var bootObserver = new MutationObserver(function () {
      var root = document.getElementById('root')
      if (root && root.childNodes.length) {
        var status = document.getElementById('boot-status')
        if (status && status.parentNode) status.parentNode.removeChild(status)
        bootObserver.disconnect()
      }
    })
    bootObserver.observe(document.documentElement, { childList: true, subtree: true })
  } catch (e) { /* MutationObserver unavailable on very old builds */ }

  function pickBundle(staged) {
    if (staged && staged.js && cmp(staged.version, baked.version) > 0) mountInjected(staged)
    else mountFromFiles(baked.version)
  }

  // Watchdog: if IndexedDB never calls back, load from disk.
  setTimeout(function () { if (!mounted) mountFromFiles(baked.version) }, 2500)

  try {
    if (typeof indexedDB === 'undefined') { mountFromFiles(baked.version); return }
    var req = indexedDB.open('finesse-ota', 1)
    req.onupgradeneeded = function () { req.result.createObjectStore('kv') }
    req.onsuccess = function () {
      try {
        var get = req.result.transaction('kv', 'readonly').objectStore('kv').get('bundle')
        get.onsuccess = function () { pickBundle(get.result) }
        get.onerror = function () { mountFromFiles(baked.version) }
      } catch (e) { mountFromFiles(baked.version) }
    }
    req.onerror = function () { mountFromFiles(baked.version) }
    req.onblocked = function () { mountFromFiles(baked.version) }
  } catch (e) {
    mountFromFiles(baked.version)
  }
})()