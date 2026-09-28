// static/layout.js

// Initial page visibility.
let currentPage = 1;

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const first = document.getElementById('page1');
  if (first) first.style.display = 'block';
});

// Sidebar navigation.
document.querySelectorAll('#navbar button').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = parseInt(btn.dataset.page, 10);
    if (page === currentPage) return;
    currentPage = page;

    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const tgt = document.getElementById('page' + page);
    if (tgt) tgt.style.display = 'block';

    document.querySelectorAll('#navbar button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Draw cached data immediately, then restore the latest server snapshot.
    if (page === 5) {
      if (typeof window.bindDimensionalityControls === 'function') {
        window.bindDimensionalityControls();
      }
      if (typeof window.refreshVisualState === 'function') {
        window.refreshVisualState();
      }
      if (typeof window.redrawHistoryCharts === 'function') window.redrawHistoryCharts();
      if (window.lastEmbPoints && window.lastFitListForEmb && typeof window.renderPopulationPanel === 'function') {
        window.renderPopulationPanel(window.lastEmbPoints, window.lastFitListForEmb);
      }
    }
  });
});

