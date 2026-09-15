/* TEMPORARY — development scaffold. Delete this file and its <script> tag in
 * index.html to remove it completely. Nothing else depends on it.
 *
 * Draws the scroll structure that is otherwise invisible: where each leg starts,
 * where its drive hands over to the arrival hold, and where the ribbon runs out.
 * Press D to toggle, or load with ?dev=0 to start hidden.
 */
(function () {
  'use strict';

  var CSS = [
    '.dev-sep{position:absolute;left:0;right:0;z-index:30;pointer-events:none}',
    '.dev-sep::before{content:"";display:block;border-top:1px dashed rgba(255,255,255,.6)}',
    '.dev-sep span{position:absolute;left:10px;top:-9px;white-space:nowrap;',
    'font:600 10px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;',
    'text-transform:uppercase;color:#0f1a0c;background:#E8C66A;padding:0 7px;border-radius:2px;',
    'box-shadow:0 1px 4px rgba(8,14,6,.5)}',
    '.dev-tag{position:sticky;top:8px;z-index:31;pointer-events:none;display:block;',
    'width:-webkit-max-content;width:max-content;margin:0 0 0 10px;',
    'font:600 10px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;',
    'text-transform:uppercase;color:#0f1a0c;background:#E8C66A;padding:0 7px;border-radius:2px;',
    'box-shadow:0 1px 4px rgba(8,14,6,.5)}',
    '.dev-sep.hold::before{border-top:1px dotted rgba(255,255,255,.42)}',
    '.dev-sep.hold span{background:rgba(12,20,10,.82);color:#E8C66A;left:auto;right:10px}',
    '.dev-sep.end::before{border-top:2px solid rgba(240,162,189,.8)}',
    '.dev-sep.end span{background:#F0A2BD}',
    '.dev-hud{position:fixed;left:10px;bottom:10px;z-index:40;pointer-events:none;',
    'font:500 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#EAF0E4;',
    'background:rgba(12,20,10,.74);border:1px solid rgba(255,255,255,.15);border-radius:5px;',
    'padding:7px 9px;min-width:158px;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}',
    '.dev-hud b{color:#E8C66A;font-weight:600}',
    '.dev-hud .phase{color:#F0A2BD}',
    '.dev-bar{position:relative;height:4px;margin:6px 0 4px;background:rgba(255,255,255,.16);',
    'border-radius:2px;overflow:hidden}',
    '.dev-bar i{position:absolute;top:0;bottom:0;left:0;background:rgba(232,198,106,.45)}',
    '.dev-bar u{position:absolute;top:0;bottom:0;width:2px;background:#fff}',
    '.dev-off .dev-sep,.dev-off .dev-hud,.dev-off .dev-tag{display:none}'
  ].join('');

  var st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  var hud, legs = [], legPx = 0, drive = 0.55;

  function num(name, dflt) {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return isFinite(v) ? v : dflt;
  }

  function build() {
    legs = [].slice.call(document.querySelectorAll('#legs .leg'));
    if (!legs.length) return false;
    drive = num('--drive', 0.55);

    legs.forEach(function (leg, i) {
      var a = document.createElement('div');
      a.className = 'dev-sep';
      a.style.top = '0';
      leg.appendChild(a);

      /* The boundary rule marks where a leg starts, but leg 1's sits at document
       * top — so once you scroll, the first label you ever see is LEG 2 and the
       * opening section looks like it does not exist. The label sticks instead. */
      var tag = document.createElement('div');
      tag.className = 'dev-tag';
      tag.textContent = 'leg ' + (i + 1) + ' / ' + legs.length;
      leg.insertBefore(tag, leg.firstChild);

      var b = document.createElement('div');
      b.className = 'dev-sep hold';
      b.style.top = 'calc(var(--leg-h) * ' + drive + ')';
      b.innerHTML = '<span>arrival hold</span>';
      leg.appendChild(b);

      if (i === legs.length - 1) {
        var c = document.createElement('div');
        c.className = 'dev-sep end';
        c.style.top = 'var(--leg-h)';
        c.innerHTML = '<span>ribbon ends · tail</span>';
        leg.appendChild(c);
      }
    });

    hud = document.createElement('div');
    hud.className = 'dev-hud';
    document.body.appendChild(hud);
    return true;
  }

  function tick() {
    if (!hud) return;
    legPx = num('--leg-h', window.innerHeight * 1.5);
    var n = legs.length, y = window.scrollY;
    var i = Math.max(0, Math.min(n - 1, Math.floor(y / legPx)));
    var t = Math.max(0, Math.min(1, (y - i * legPx) / legPx));
    var moving = t < drive;

    var tr = document.getElementById('ribbon').style.transform || '';
    var m = tr.match(/,\s*(-?[\d.]+)px/);
    var d = m ? -parseFloat(m[1]) : 0;

    hud.innerHTML =
      'leg <b>' + (i + 1) + '</b> of ' + n +
      ' &nbsp;<span class="phase">' + (moving ? 'driving' : 'HOLD') + '</span>' +
      '<div class="dev-bar"><i style="width:' + (drive * 100).toFixed(1) + '%"></i>' +
      '<u style="left:' + (t * 100).toFixed(1) + '%"></u></div>' +
      't ' + t.toFixed(2) + ' &nbsp; travelled <b>' + Math.round(d) + '</b>px';
  }

  /* The engine applies its transform in a rAF scheduled from the same scroll event,
   * so reading straight out of the scroll handler samples the PREVIOUS frame. Run a
   * short frame loop instead and always read what is actually on screen. */
  var raf = 0, hot = 0;
  function frame() {
    raf = 0;
    tick();
    if (--hot > 0) raf = requestAnimationFrame(frame);
  }
  function ping() {
    hot = 20;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!build()) return setTimeout(start, 120);
    ping();
    addEventListener('scroll', ping, { passive: true });
    addEventListener('resize', ping);
  }

  if (new URLSearchParams(location.search).get('dev') === '0') {
    document.documentElement.classList.add('dev-off');
  }
  addEventListener('keydown', function (e) {
    if (e.key === 'd' || e.key === 'D') document.documentElement.classList.toggle('dev-off');
  });

  start();
})();
