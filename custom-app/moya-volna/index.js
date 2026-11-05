(function () {
  const react = Spicetify.React;
  const e = react.createElement;

  const IS_RU = (navigator.language || "en").toLowerCase().startsWith("ru");
  const STRINGS = {
    title: IS_RU ? "Моя волна" : "My Wave",
    subtitle: IS_RU
      ? "Бесконечный поток треков, подобранных под то, что ты сейчас слушаешь"
      : "An endless stream of tracks picked around whatever you're playing",
    waveOn: IS_RU ? "Волна включена" : "Wave is on",
    waveOff: IS_RU ? "Волна выключена, нажми play" : "Wave is off, press play",
    basedOnLiked: IS_RU ? "На основе «Любимых треков»" : "Based on Liked Songs",
    notReady: IS_RU
      ? "Расширение rivers.js ещё не загрузилось, подожди и обнови страницу"
      : "The rivers.js extension hasn't loaded yet, wait and reload the page",
  };

  const LIKED_SONGS_URI = "spotify:collection:tracks";

  function trackLabel(track) {
    if (!track) return STRINGS.basedOnLiked;
    const artists = Array.isArray(track.artists)
      ? track.artists.map((artist) => artist?.name).filter(Boolean).join(", ")
      : "";
    const name = track.name || "";
    return artists ? `${artists} — ${name}` : name || STRINGS.basedOnLiked;
  }

  class MoyaVolnaPage extends react.Component {
    constructor(props) {
      super(props);
      this.state = {
        isPlaying: Boolean(Spicetify.Player?.isPlaying?.()),
        track: Spicetify.Player?.data?.item ?? Spicetify.Player?.data?.track ?? null,
        waveEnabled: Boolean(window.ShadowRivers?.isWaveEnabled?.()),
      };
      this.handlePlayPause = this.handlePlayPause.bind(this);
      this.handleSongChange = this.handleSongChange.bind(this);
      this.handleClick = this.handleClick.bind(this);
    }

    componentDidMount() {
      Spicetify.Player.addEventListener("onplaypause", this.handlePlayPause);
      Spicetify.Player.addEventListener("songchange", this.handleSongChange);
    }

    componentWillUnmount() {
      Spicetify.Player.removeEventListener("onplaypause", this.handlePlayPause);
      Spicetify.Player.removeEventListener("songchange", this.handleSongChange);
    }

    handlePlayPause(event) {
      const isPaused = event?.data?.isPaused;
      this.setState({
        isPlaying: typeof isPaused === "boolean" ? !isPaused : Boolean(Spicetify.Player?.isPlaying?.()),
      });
    }

    handleSongChange() {
      this.setState({
        track: Spicetify.Player?.data?.item ?? Spicetify.Player?.data?.track ?? null,
        waveEnabled: Boolean(window.ShadowRivers?.isWaveEnabled?.()),
      });
    }

    handleClick() {
      if (!window.ShadowRivers) {
        Spicetify.showNotification(STRINGS.notReady, true);
        return;
      }

      if (Spicetify.Player.isPlaying()) {
        Spicetify.Player.pause();
        return;
      }

      const seedUri = window.ShadowRivers.currentContextUri() || LIKED_SONGS_URI;
      Spicetify.Player.playUri(seedUri);
      setTimeout(() => window.ShadowRivers.activate(), 1500);
      this.setState({ waveEnabled: true });
    }

    render() {
      return e(
        "div",
        { style: styles.page },
        e("div", { style: styles.glowA }),
        e("div", { style: styles.glowB }),
        e(
          "div",
          { style: styles.content },
          e("h1", { style: styles.title }, STRINGS.title),
          e("p", { style: styles.subtitle }, STRINGS.subtitle),
          e(
            "button",
            { style: styles.playButton, onClick: this.handleClick },
            this.state.isPlaying
              ? e(
                  "svg",
                  { viewBox: "0 0 24 24", width: 30, height: 30 },
                  e("rect", { x: 6, y: 5, width: 4, height: 14, rx: 1, fill: "#121212" }),
                  e("rect", { x: 14, y: 5, width: 4, height: 14, rx: 1, fill: "#121212" }),
                )
              : e("svg", { viewBox: "0 0 24 24", width: 30, height: 30 }, e("path", {
                  d: "M7 5l13 7-13 7V5z",
                  fill: "#121212",
                })),
          ),
          e("div", { style: styles.track }, trackLabel(this.state.track)),
          e(
            "div",
            { style: { ...styles.status, color: this.state.waveEnabled ? "#1ED760" : "#9aa1ad" } },
            this.state.waveEnabled ? STRINGS.waveOn : STRINGS.waveOff,
          ),
        ),
      );
    }
  }

  const styles = {
    page: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "80vh",
      overflow: "hidden",
      borderRadius: "12px",
      background: "#121212",
    },
    glowA: {
      position: "absolute",
      width: "520px",
      height: "520px",
      borderRadius: "50%",
      top: "-120px",
      left: "-80px",
      background: "radial-gradient(circle, rgba(30,215,96,0.35) 0%, rgba(30,215,96,0) 70%)",
      filter: "blur(10px)",
      animation: "rivers-pulse 7s ease-in-out infinite",
    },
    glowB: {
      position: "absolute",
      width: "480px",
      height: "480px",
      borderRadius: "50%",
      bottom: "-140px",
      right: "-100px",
      background: "radial-gradient(circle, rgba(80,120,255,0.3) 0%, rgba(80,120,255,0) 70%)",
      filter: "blur(10px)",
      animation: "rivers-pulse 9s ease-in-out infinite reverse",
    },
    content: {
      position: "relative",
      zIndex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "18px",
      textAlign: "center",
      padding: "32px",
    },
    title: {
      fontSize: "48px",
      fontWeight: 800,
      margin: 0,
      color: "#ffffff",
      letterSpacing: "-0.01em",
    },
    subtitle: {
      fontSize: "15px",
      color: "#b3b3b3",
      margin: 0,
      maxWidth: "420px",
    },
    playButton: {
      marginTop: "12px",
      width: "72px",
      height: "72px",
      borderRadius: "50%",
      border: "none",
      background: "#1ED760",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      boxShadow: "0 8px 24px rgba(30,215,96,0.35)",
    },
    track: {
      marginTop: "8px",
      fontSize: "14px",
      color: "#e7e9ee",
    },
    status: {
      fontSize: "12px",
      fontWeight: 600,
      textTransform: "uppercase",
      letterSpacing: "0.06em",
    },
  };

  if (!document.getElementById("rivers-wave-keyframes")) {
    const styleTag = document.createElement("style");
    styleTag.id = "rivers-wave-keyframes";
    styleTag.textContent =
      "@keyframes rivers-pulse { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.15); opacity: 1; } }";
    document.head.appendChild(styleTag);
  }

  function render() {
    return e(MoyaVolnaPage);
  }

  module.exports = render;
})();
