if (new URLSearchParams(location.search).get('error') === '1') {
  document.getElementById('title').textContent = 'היומן לא חובר';
  document.getElementById('message').textContent = 'האישור לא הושלם או שפג תוקפו. חזור לאפליקציה ונסה לחבר שוב.';
}
