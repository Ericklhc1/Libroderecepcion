self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target =
    event.notification && event.notification.data && event.notification.data.url
      ? String(event.notification.data.url)
      : '/notificaciones';

  const absolute = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => client.url.startsWith(self.location.origin));
        if (existing) {
          if ('navigate' in existing) {
            return existing.navigate(absolute).then(() => existing.focus());
          }
          return existing.focus();
        }
        return self.clients.openWindow(absolute);
      }),
  );
});
