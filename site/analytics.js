/* Google Analytics 4 — unique visitors (GA's "Users") plus one custom event,
 * take_me_here {venue}, fired from every "Take me here" tap on v1 (road.js)
 * and v2 (v2/ui/overlays.js). Loaded by index.html, v2/index.html and
 * v2/credits.html. Pages call window.track(name, params); it's a no-op until
 * GA_ID is set and on localhost, so dev and headless QA runs aren't counted. */
(function () {
  var GA_ID = 'G-KQ2BQBEXF1';
  var off = !/^G-[A-Z0-9]+$/.test(GA_ID) || GA_ID === 'G-XXXXXXXXXX' ||
    /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);

  window.track = function () {};
  if (off) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID);
  window.track = function (name, params) { gtag('event', name, params || {}); };

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);
})();
