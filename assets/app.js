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
})();
