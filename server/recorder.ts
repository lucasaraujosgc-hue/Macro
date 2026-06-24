export const recorderScript = `
<script>
(function() {
  function getSelector(el) {
    if (el.tagName.toLowerCase() == "html")
      return "HTML";
    var str = el.tagName.toLowerCase();
    str += (el.id != "") ? "#" + el.id : "";
    if (el.className) {
      var classes = el.className.trim().split(/\\s+/);
      for (var i = 0; i < classes.length; i++) {
        str += "." + classes[i];
      }
    }
    return str;
  }

  document.addEventListener('click', e => {
    let selector = getSelector(e.target);
    window.parent.postMessage({ type: 'recorder_click', selector }, '*');
    
    // Intercept links to keep them inside proxy
    let current = e.target;
    while(current && current.tagName !== 'A') {
      current = current.parentNode;
    }
    if (current && current.tagName === 'A' && current.href) {
      e.preventDefault();
      e.stopPropagation();
      let href = current.getAttribute('href');
      if (href && !href.startsWith('javascript:')) {
         window.parent.postMessage({ type: 'recorder_navigate', url: current.href }, '*');
         window.location.href = current.href;
      }
    }
  }, true);

  document.addEventListener('change', e => {
    let selector = getSelector(e.target);
    window.parent.postMessage({ type: 'recorder_type', selector, value: e.target.value }, '*');
  }, true);
})();
</script>
`;
