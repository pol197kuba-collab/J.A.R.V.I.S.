// Service worker J.A.R.V.I.S.-a — istnieje wyłącznie po to, żeby meldunek
// dotarł na urządzenie przy zamkniętej karcie. Nie cache'uje niczego i nie
// przechwytuje żądań: przeglądarka wymaga service workera do Web Push, ale
// nie wymaga, żeby robił cokolwiek ponad to. Cichy worker, który tylko
// nasłuchuje, jest tu bezpieczniejszy niż taki, który zaczyna serwować
// nieaktualne wersje aplikacji z pamięci.

// Nowa wersja workera przejmuje kontrolę od razu, zamiast czekać na
// zamknięcie wszystkich kart. Bez tego poprawka w obsłudze powiadomień
// wchodziłaby w życie dopiero przy następnym uruchomieniu przeglądarki.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // Ładunek jest naszego autorstwa, ale przychodzi przez usługę pośredniczącą
  // — jeśli okaże się nie-JSON-em, lepszy meldunek bez szczegółów niż wyjątek
  // i cisza.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "J.A.R.V.I.S.", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "J.A.R.V.I.S.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      // Meldunki z tego samego rozkazu zastępują się nawzajem, zamiast
      // budować stos powiadomień o tej samej treści.
      tag: data.tag || "jarvis",
      data: { url: data.url || "/" },
      timestamp: Date.now(),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  // Jeśli aplikacja jest już gdzieś otwarta, przenosimy tamtą kartę na
  // właściwy moduł zamiast otwierać drugą kopię.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
