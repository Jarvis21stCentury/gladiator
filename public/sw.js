/*
 * The service worker exists only to receive pushes.
 *
 * Deliberately not a caching or offline worker. This app is entirely
 * server-rendered against live data — grades, what is due, tonight's plan — and
 * a cache would serve yesterday's homework with no way to tell. The one job
 * here is to be alive when the page is closed, which is the whole point.
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Gladiator", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Gladiator";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // Same tag replaces an earlier notification rather than stacking, so a
      // week away does not come back to seven identical reminders.
      tag: data.tag || "gladiator",
      renotify: true,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  /*
   * Focus an existing tab rather than opening a second one. A student who taps
   * a reminder every evening should not end up with nine copies of the app.
   */
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      for (const client of all) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    }),
  );
});
