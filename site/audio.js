/* Scroll-reactive background music: a 30s loop that starts muffled and quiet,
 * then opens up toward full and bright as the guest scrolls through the
 * journey. Off by default — first user gesture (the toggle) is the only
 * thing allowed to start it, so there is never an autoplay violation to
 * work around. Reads scroll progress off window.RoadFX (set every frame by
 * road.js's own rAF loop) instead of running a second scroll listener. */
(function () {
  'use strict';

  var HINT_KEY = 'music-hint-seen';
  var LP_MIN = 700, LP_MAX = 18000;   // muffled -> bright, Hz
  /* Kept low even at "full" — this is a soothing background bed under a page
   * people are reading, not a foreground track, and the source is already
   * normalized to -18 LUFS so 1.0 gain here would be too loud to sit under. */
  var VOL_MIN = 0.14, VOL_MAX = 0.45;
  var SECTION_BOOST = 0.03;

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var btn, hint, audio;
  var ctx, filter, gain, wasPlayingBeforeHide = false;
  var started = false;
  var raf = 0;
  var pauseGen = 0;
  /* Source of truth for "is music on" from the user's point of view — audio.paused
   * lags this by up to 500ms during the fade-out, so toggle()/updateButton() key
   * off this instead of the element, or a click during that window desyncs the
   * button from what actually happens (or double-fires the fade). */
  var isOn = false;

  function $(id) { return document.getElementById(id); }

  function init() {
    btn = $('musicToggle');
    hint = $('musicHint');
    audio = $('bg-audio');
    if (!btn || !audio) return;

    btn.addEventListener('click', toggle);
    document.addEventListener('visibilitychange', onVisibility);

    showHintOnce();
  }

  function showHintOnce() {
    if (!hint) return;
    var seen = false;
    try { seen = localStorage.getItem(HINT_KEY) === '1'; } catch (e) {}
    if (seen) { hint.remove(); return; }
    setTimeout(function () { hint.classList.add('is-hidden'); }, 4000);
  }

  function dismissHint() {
    if (!hint) return;
    hint.classList.add('is-hidden');
    try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
  }

  function initAudioGraph() {
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    var src = ctx.createMediaElementSource(audio);
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = RM ? LP_MAX : LP_MIN;
    gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(ctx.destination);
    started = true;
  }

  async function toggle() {
    dismissHint();
    if (!started) initAudioGraph();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }

    if (!isOn) {
      isOn = true;
      pauseGen++;
      updateButton();
      try { await audio.play(); } catch (e) { isOn = false; updateButton(); return; }
      applyLevels(true);
      ping();
    } else {
      fadeOutAndPause();
    }
  }

  function fadeOutAndPause() {
    isOn = false;
    updateButton();
    var t = ctx.currentTime;
    gain.gain.setTargetAtTime(0, t, 0.15);
    var gen = ++pauseGen;
    setTimeout(function () {
      if (audio && gen === pauseGen) audio.pause();
    }, 500);
  }

  function progress() {
    if (window.RoadFX && typeof window.RoadFX.prog === 'number') {
      return Math.min(1, Math.max(0, window.RoadFX.prog));
    }
    var max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }

  function applyLevels(fromToggle) {
    if (!started || !isOn) return;
    var t = ctx.currentTime;
    var tau = fromToggle ? 0.6 : 0.12;

    if (RM) {
      filter.frequency.setTargetAtTime(LP_MAX, t, tau);
      gain.gain.setTargetAtTime(VOL_MAX, t, tau);
      return;
    }

    var p = progress();
    var eased = p * p * (3 - 2 * p);
    var freq = LP_MIN * Math.pow(LP_MAX / LP_MIN, eased);
    var vol = VOL_MIN + eased * (VOL_MAX - VOL_MIN);

    var fx = window.RoadFX;
    if (fx && (fx.onVizag || fx.onDam)) vol = Math.min(1, vol + SECTION_BOOST);

    filter.frequency.setTargetAtTime(freq, t, tau);
    gain.gain.setTargetAtTime(vol, t, tau);
  }

  function updateButton() {
    if (!btn) return;
    btn.textContent = isOn ? '❚❚' : '♪';
    btn.setAttribute('aria-label', isOn ? 'Pause music' : 'Play music');
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
  }

  function onVisibility() {
    if (!started) return;
    if (document.hidden) {
      wasPlayingBeforeHide = isOn;
      if (isOn) fadeOutAndPause();
    } else if (wasPlayingBeforeHide) {
      wasPlayingBeforeHide = false;
      isOn = true;
      pauseGen++;
      updateButton();
      ctx.resume().then(function () {
        return audio.play();
      }).then(function () {
        applyLevels(true);
        ping();
      }).catch(function () { isOn = false; updateButton(); });
    }
  }

  /* Polls RoadFX.prog once per frame instead of adding a second scroll
   * listener. Only runs while music is actually playing — starts on play,
   * stops itself the moment the track is paused, so an idle page never
   * pays for a running rAF loop. */
  function ping() {
    if (!started || !isOn) { raf = 0; return; }
    applyLevels(false);
    raf = requestAnimationFrame(ping);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
