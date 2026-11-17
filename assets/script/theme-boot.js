// Before first paint, on every page: the saved theme and sidebar state.
// A file, not inline, so the Content-Security-Policy can refuse inline scripts.
if (localStorage.getItem('ledger_theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
}
try {
    if (localStorage.getItem('ledger_side_nav') === 'closed') {
        document.documentElement.dataset.sideNav = 'closed';
    }
} catch (e) {}
