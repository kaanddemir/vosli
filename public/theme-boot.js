(function () {
  var dark = '#191919';
  var light = '#F7F5F1';
  var pref = 'system';
  try {
    pref = localStorage.getItem('vosli.theme') || 'system';
    if (localStorage.getItem('vosli.sidebar') === 'collapsed') document.documentElement.dataset.sidebar = 'collapsed';
    if (localStorage.getItem('vosli.article-colors') === 'on') document.documentElement.dataset.articleColors = 'on';
  } catch (e) {}
  if (pref !== 'light' && pref !== 'dark') pref = 'system';
  var isDark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = isDark ? dark : light;
})();
