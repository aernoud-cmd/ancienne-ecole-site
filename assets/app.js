(function(){
  function show(key, idx){
    var data = window.AE_CAROUSELS && window.AE_CAROUSELS[key];
    if (!data) return;
    var n = data.imgs.length;
    idx = ((idx % n) + n) % n;
    var stage = document.getElementById('ae-stage-' + key);
    var cap = document.getElementById('ae-cap-' + key);
    if (stage) { stage.src = data.imgs[idx]; stage.setAttribute('data-idx', idx); }
    if (cap) { cap.textContent = data.caps[idx]; }
    var thumbs = document.getElementById('ae-thumbs-' + key);
    if (thumbs) {
      for (var i = 0; i < thumbs.children.length; i++) {
        thumbs.children[i].classList.toggle('active', i === idx);
      }
    }
  }
  function step(key, delta){
    var stage = document.getElementById('ae-stage-' + key);
    var idx = stage ? parseInt(stage.getAttribute('data-idx') || '0', 10) : 0;
    show(key, idx + delta);
  }
  window.aeShow = show;
  window.aeNext = function(key){ step(key, 1); };
  window.aePrev = function(key){ step(key, -1); };

  window.aeToggleNav = function(){
    var m = document.getElementById('ae-nav-mobile');
    if (m) m.classList.toggle('open');
  };

  // Keeps the homepage's "sleeps N guests" line honest with whatever the
  // owner has actually configured in /admin, instead of a hand-typed number
  // that silently drifts out of date (this is exactly how the copy ended up
  // saying "8 adults + 1 child" while the real configured max was 8 guests
  // total). The element's own static text is the fallback shown until (or
  // if) this fetch succeeds, so a slow/broken network never shows nothing.
  function updateCapacityBlurb(){
    var el = document.getElementById('ae-capacity-blurb');
    if (!el) return;
    var template = el.getAttribute('data-capacity-template');
    if (!template) return;
    fetch('/.netlify/functions/availability')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var n = data && data.capacity && data.capacity.maxTotalGuests;
        if (typeof n === 'number' && n > 0) {
          el.textContent = template.replace('{n}', n);
        }
      })
      .catch(function () { /* keep the static fallback text already in the page */ });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateCapacityBlurb);
  } else {
    updateCapacityBlurb();
  }
})();
