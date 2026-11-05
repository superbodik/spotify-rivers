(async function Rivers() {
  while (
    !Spicetify?.Platform?.PlayerAPI ||
    !Spicetify?.Player ||
    !Spicetify?.CosmosAsync ||
    !Spicetify?.Queue ||
    !Spicetify?.LocalStorage
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const CURRENT_VERSION = "1.0.1";
  const VERSION_MANIFEST_URL = "https://raw.githubusercontent.com/superbodik/spotify-rivers/main/version.json";
  const VERSION_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
  const LAST_CHECK_KEY = "rivers:lastVersionCheck";
  const NOTIFIED_VERSION_KEY = "rivers:notifiedVersion";
  const AUTOPLAY_HINT_SHOWN_KEY = "rivers:autoplayHintShown";

  const QUEUE_LOW_WATERMARK = 2;
  const MAX_TRACKS_TO_ADD = 10;
  const RECENT_HISTORY_LIMIT = 80;
  const ARTIST_OVERUSE_WINDOW = 8;
  const ARTIST_OVERUSE_LIMIT = 3;
  const QUEUE_CHECK_INTERVAL_MS = 15000;

  const IS_RU = (navigator.language || "en").toLowerCase().startsWith("ru");
  const STRINGS = {
    waveLabel: IS_RU ? "Моя волна" : "My Wave",
    waveOn: IS_RU ? "Rivers: Моя волна включена" : "Rivers: My Wave is on",
    waveOff: IS_RU ? "Rivers: Моя волна выключена" : "Rivers: My Wave is off",
    waveNeedsTrack: IS_RU
      ? "Rivers: включи любой трек, чтобы начать «Мою волну»"
      : "Rivers: play a track first to start My Wave",
    bonusUnavailable: IS_RU
      ? "Rivers: свой подбор треков сейчас недоступен (эндпоинт Spotify поменялся), едем на встроенном Autoplay"
      : "Rivers: our own track picker is unavailable right now (Spotify's endpoint changed), relying on built-in Autoplay",
    autoplayHint: IS_RU
      ? "Rivers: проверь, что в Настройках Spotify → Воспроизведение включён Autoplay — без него очередь может закончиться"
      : "Rivers: make sure Autoplay is on in Spotify Settings → Playback — without it the queue can run out",
  };
  const WAVE_ICON =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M1 8c1.333-2 2.667-2 4 0s2.667 2 4 0 2.667-2 4 0 2.667 2 4 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
    "</svg>";

  const recentUris = new Set();
  const recentArtists = [];
  let isFilling = false;
  let waveEnabled = true;
  let bonusPickerBroken = false;

  function rememberTrack(uri, artistUris) {
    if (!uri) return;
    recentUris.add(uri);
    if (recentUris.size > RECENT_HISTORY_LIMIT) {
      const [oldest] = recentUris;
      recentUris.delete(oldest);
    }
    for (const artistUri of artistUris) {
      recentArtists.push(artistUri);
    }
    while (recentArtists.length > RECENT_HISTORY_LIMIT) {
      recentArtists.shift();
    }
  }

  function artistIsOverused(artistUris) {
    const window = recentArtists.slice(-ARTIST_OVERUSE_WINDOW);
    return artistUris.some(
      (uri) => window.filter((candidate) => candidate === uri).length >= ARTIST_OVERUSE_LIMIT,
    );
  }

  function extractArtistUris(track) {
    if (Array.isArray(track?.artists)) {
      return track.artists.map((artist) => artist?.uri).filter(Boolean);
    }
    return [];
  }

  function currentContextUri() {
    return (
      Spicetify.Player?.data?.item?.uri ??
      Spicetify.Player?.data?.track?.uri ??
      Spicetify.Queue?.track?.contextTrack?.uri ??
      null
    );
  }

  async function fetchStationTracks(seedUri) {
    console.debug("[rivers] запрашиваю станцию для", seedUri);
    const autoplay = await Spicetify.CosmosAsync.get(
      `hm://autoplay-enabled/query?uri=${encodeURIComponent(seedUri)}`,
    );
    console.debug("[rivers] ответ autoplay-enabled:", autoplay);
    const stationUri = autoplay?.stations?.[0] ?? autoplay?.uri ?? null;
    if (!stationUri) {
      throw new Error("автовоспроизведение не вернуло станцию для текущего трека");
    }

    const station = await Spicetify.CosmosAsync.get(
      `hm://radio-apollo/v3/stations/${encodeURIComponent(stationUri)}`,
    );
    console.debug("[rivers] ответ radio-apollo:", station);
    const tracks = station?.tracks;
    if (!Array.isArray(tracks) || tracks.length === 0) {
      throw new Error("станция вернула пустой список треков");
    }
    return tracks;
  }

  async function fillQueue(force = false) {
    if (isFilling || !waveEnabled) return;
    if (bonusPickerBroken && !force) return;

    const nextTracks = Spicetify.Queue?.nextTracks ?? [];
    if (!force && nextTracks.length > QUEUE_LOW_WATERMARK) return;

    const seedUri = currentContextUri();
    if (!seedUri) return;

    isFilling = true;
    try {
      const tracks = await fetchStationTracks(seedUri);
      const toAdd = [];
      for (const track of tracks) {
        if (toAdd.length >= MAX_TRACKS_TO_ADD) break;
        const uri = track?.uri ?? track?.uri_string;
        if (!uri || recentUris.has(uri)) continue;
        const artistUris = extractArtistUris(track);
        if (artistIsOverused(artistUris)) continue;
        toAdd.push({ uri });
        rememberTrack(uri, artistUris);
      }

      if (toAdd.length === 0) {
        if (force) Spicetify.showNotification("Rivers: не нашлось новых треков для продолжения", true);
        return;
      }

      await Spicetify.addToQueue(toAdd);
      Spicetify.showNotification(`Rivers: добавлено ${toAdd.length} треков`);
      bonusPickerBroken = false;
    } catch (error) {
      console.error("[rivers] свой подбор треков не сработал:", error);
      bonusPickerBroken = true;
      if (force) Spicetify.showNotification(STRINGS.bonusUnavailable, true);
    } finally {
      isFilling = false;
    }
  }

  Spicetify.Player.addEventListener("songchange", () => {
    const item = Spicetify.Player.data?.item ?? Spicetify.Player.data?.track;
    if (item?.uri) {
      rememberTrack(item.uri, extractArtistUris(item));
    }
    fillQueue();
  });

  setInterval(fillQueue, QUEUE_CHECK_INTERVAL_MS);

  async function checkForUpdate() {
    try {
      const lastCheck = Number(Spicetify.LocalStorage.get(LAST_CHECK_KEY) ?? 0);
      if (Date.now() - lastCheck < VERSION_CHECK_INTERVAL_MS) return;
      Spicetify.LocalStorage.set(LAST_CHECK_KEY, String(Date.now()));

      const response = await fetch(VERSION_MANIFEST_URL, { cache: "no-store" });
      if (!response.ok) return;

      const manifest = await response.json();
      const remoteVersion = manifest?.version;
      if (!remoteVersion || remoteVersion === CURRENT_VERSION) return;

      const alreadyNotified = Spicetify.LocalStorage.get(NOTIFIED_VERSION_KEY);
      if (alreadyNotified === remoteVersion) return;

      Spicetify.LocalStorage.set(NOTIFIED_VERSION_KEY, remoteVersion);
      Spicetify.showNotification(
        `Rivers: доступна версия ${remoteVersion}, установится при следующем входе в Windows`,
      );
    } catch (error) {
      console.error("[rivers] проверка версии не удалась:", error);
    }
  }

  checkForUpdate();
  setInterval(checkForUpdate, VERSION_CHECK_INTERVAL_MS);

  let waveButton = null;
  if (Spicetify.Playbar?.Button) {
    waveButton = new Spicetify.Playbar.Button(
      STRINGS.waveLabel,
      WAVE_ICON,
      () => toggleWave(),
      false,
      waveEnabled,
      false,
    );
    waveButton.register();
  } else {
    console.warn("[rivers] Spicetify.Playbar.Button недоступен в этой версии клиента");
  }

  function ensureNativeAutoplayCanTakeOver() {
    try {
      Spicetify.Player.setRepeat(0);
    } catch (error) {
      console.warn("[rivers] не удалось выключить repeat:", error);
    }
    if (!Spicetify.LocalStorage.get(AUTOPLAY_HINT_SHOWN_KEY)) {
      Spicetify.LocalStorage.set(AUTOPLAY_HINT_SHOWN_KEY, "1");
      Spicetify.showNotification(STRINGS.autoplayHint);
    }
  }

  function activateWave() {
    waveEnabled = true;
    if (waveButton) waveButton.active = true;
    ensureNativeAutoplayCanTakeOver();
    fillQueue(true);
  }

  function toggleWave() {
    if (waveEnabled) {
      waveEnabled = false;
      if (waveButton) waveButton.active = false;
      Spicetify.showNotification(STRINGS.waveOff);
      return;
    }

    const seedUri = currentContextUri();
    if (!seedUri) {
      Spicetify.showNotification(STRINGS.waveNeedsTrack, true);
      return;
    }
    activateWave();
    Spicetify.showNotification(STRINGS.waveOn);
  }

  window.ShadowRivers = {
    isWaveEnabled: () => waveEnabled,
    enableWave: () => {
      if (!waveEnabled) toggleWave();
    },
    disableWave: () => {
      if (waveEnabled) toggleWave();
    },
    activate: activateWave,
    fillQueueNow: () => fillQueue(true),
    currentContextUri,
    strings: STRINGS,
    isRu: IS_RU,
  };

  console.log(`[rivers] расширение загружено, версия ${CURRENT_VERSION}`);
})();
