import Hls from "hls.js";

interface HlsVideoOptions {
  live?: boolean;
  onError: (message: string) => void;
  onPlaying: () => void;
  onWaiting?: () => void;
  retryLimit?: number;
}

export function attachHlsVideo(
  video: HTMLVideoElement,
  source: string,
  options: HlsVideoOptions,
): () => void {
  let disposed = false;
  let retryCount = 0;
  let retryTimer: number | null = null;

  const play = () => {
    if (disposed) return;
    void video.play()
      .then(() => {
        if (!disposed) options.onPlaying();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        // Браузер сам ставит на паузу фоновое видео без звука ради экономии
        // энергии и отклоняет play() с AbortError. Это не отказ воспроизведения:
        // как только вкладка снова активна, playing приходит штатно. Показывать
        // оператору "The play() request was interrupted…" здесь нечего.
        if (error instanceof DOMException && error.name === "AbortError") return;
        options.onError(error instanceof Error ? error.message : "Video playback failed");
      });
  };

  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: false,
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: options.live ? 6 : 10,
      lowLatencyMode: true,
      maxBufferLength: options.live ? 12 : 30,
    });
    const retryLimit = options.retryLimit ?? 20;

    const load = () => {
      if (disposed) return;
      options.onWaiting?.();
      hls.loadSource(source);
    };

    hls.attachMedia(video);
    hls.on(Hls.Events.MEDIA_ATTACHED, load);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      retryCount = 0;
      play();
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal || disposed) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        options.onWaiting?.();
        hls.recoverMediaError();
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCount < retryLimit) {
        retryCount += 1;
        options.onWaiting?.();
        if (retryTimer != null) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(load, Math.min(2_000, 350 + retryCount * 150));
        return;
      }
      options.onError(`HLS preview error: ${data.details}`);
    });

    return () => {
      disposed = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      hls.destroy();
      resetVideo(video);
    };
  }

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    const handleLoaded = () => play();
    const handleError = () => options.onError("Native HLS playback failed");
    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.src = source;
    video.load();
    return () => {
      disposed = true;
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("error", handleError);
      resetVideo(video);
    };
  }

  options.onError("HLS preview is not supported by this system");
  return () => {
    disposed = true;
    resetVideo(video);
  };
}

function resetVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute("src");
  video.load();
}
