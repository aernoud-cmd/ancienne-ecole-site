// Installed on the three WordPress reservation pages. Only our own booking
// frame may request navigation, and only to Stripe's hosted Checkout origin.
(function () {
  window.addEventListener('message', function (event) {
    if (event.origin !== 'https://ancienne-ecole-troche.netlify.app') return;
    var frame = document.getElementById('ae-booking-iframe');
    if (!frame || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.aeSource !== 'ae-booking-embed' || data.type !== 'ae-checkout') return;
    try {
      var url = new URL(data.checkoutUrl);
      if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password) return;
      window.location.assign(url.href);
    } catch (_) { /* Ignore malformed messages. */ }
  });
})();
