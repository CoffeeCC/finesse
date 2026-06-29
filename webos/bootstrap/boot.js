/* webOS launch bootstrap.
 *
 * The .ipk bakes in the app as { version, css, js } via baked.js
 * (window.__BAKED__). The OTA updater (src/lib/webosUpdate.ts) may have stashed
 * a newer { version, css, js } in IndexedDB. We pick whichever version is higher
 * and mount it into THIS document — staying on the same file:// origin so
 * localStorage / session / deviceId all carry over.
 *
 * The app is injected as LIVE <style> and <script> elements (createElement +
 * appendChild), which the spec guarantees will execute — unlike document.write
 * after load or innerHTML, both of which are unreliable. If anything fails we
 * fall back to the baked-in copy, so a bad OTA download can never brick the app. */
(function () {
  var baked = window.__BAKED__ || { version: '0.0.0', css: '', js: '' }

  function cmp(a, b) {
    a = String(a || '0').replace(/^v/, '').split('.')
    b = String(b || '0').replace(/^v/, '').split('.')
    for (var i = 0; i < 3; i++) {
      var d = (parseInt(a[i], 10) || 0) - (parseInt(b[i], 10) || 0)
      if (d !== 0) return d > 0 ? 1 : -1
    }
    return 0
  }

  function mount(bundle) {
    var b = bundle && bundle.js ? bundle : baked
    if (!b || !b.js) {
      document.getElementById('boot').textContent = 'Finesse failed to load.'
      return
    }
    // Expose the running version to the app (currentVersion() reads this).
    window.__APP_VERSION__ = b.version

    // Clear the splash, give the app its mount node.
    document.body.innerHTML = '<div id="root"></div>'

    if (b.css) {
      var style = document.createElement('style')
      style.textContent = b.css
      document.head.appendChild(style)
    }
    var script = document.createElement('script')
    script.textContent = b.js // classic iife — executes on append
    document.body.appendChild(script)
  }

  // Try the OTA-staged bundle; fall back to baked on any error.
  try {
    var req = indexedDB.open('finesse-ota', 1)
    req.onupgradeneeded = function () { req.result.createObjectStore('kv') }
    req.onsuccess = function () {
      try {
        var get = req.result.transaction('kv', 'readonly').objectStore('kv').get('bundle')
        get.onsuccess = function () {
          var s = get.result
          mount(s && s.js && cmp(s.version, baked.version) > 0 ? s : baked)
        }
        get.onerror = function () { mount(baked) }
      } catch (e) { mount(baked) }
    }
    req.onerror = function () { mount(baked) }
  } catch (e) {
    mount(baked)
  }
})()
