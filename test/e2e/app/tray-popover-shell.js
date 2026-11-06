const frame = document.getElementById('window');
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'resize') frame.style.height = `${event.data.height}px`;
});
