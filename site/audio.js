/* Background music: a 30s loop at one constant, fixed volume - no longer
 * scroll-reactive (an earlier version ramped volume/filter with scroll
 * progress; dropped in favour of a flat, predictable level throughout). Off
 * by default — first user gesture (the toggle) is the only thing allowed to
 * start it, so there is never an autoplay violation to work around. */
(function () {
  'use strict';

  /* Flat volume for the whole track. The source is already normalized to
   * -18 LUFS, so 1.0 gain here would be too loud to sit under a page people
   * are reading - 0.3 is the requested fixed level. */
  var VOL = 0.3;

  var btn, audio;
  var ctx, gain, wasPlayingBeforeHide = false;
  var started = false;
  var pauseGen = 0;
  /* Source of truth for "is music on" from the user's point of view — audio.paused
   * lags this by up to 500ms during the fade-out, so toggle()/updateButton() key
   * off this instead of the element, or a click during that window desyncs the
   * button from what actually happens (or double-fires the fade). */
  var isOn = false;

  function $(id) { return document.getElementById(id); }

  function init() {
    btn = $('musicToggle');
    audio = $('bg-audio');
    if (!btn || !audio) return;

    btn.addEventListener('click', toggle);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function initAudioGraph() {
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    var src = ctx.createMediaElementSource(audio);
    gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(ctx.destination);
    started = true;
  }

  async function toggle() {
    if (!started) initAudioGraph();
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (e) {} }

    if (!isOn) {
      isOn = true;
      pauseGen++;
      updateButton();
      try { await audio.play(); } catch (e) { isOn = false; updateButton(); return; }
      gain.gain.setTargetAtTime(VOL, ctx.currentTime, 0.6);
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
        gain.gain.setTargetAtTime(VOL, ctx.currentTime, 0.6);
      }).catch(function () { isOn = false; updateButton(); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
