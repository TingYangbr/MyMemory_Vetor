import { useState } from "react";
import type { MemoRecentCard } from "@mymemory/shared";
import { memoCardHasAttachment, resolvePublicMediaSrc } from "./memoCardDisplayUtils";
import styles from "./MemoCardRow.module.css";

type Props = {
  m: MemoRecentCard;
  apiBase: string;
};

/** Mini visualização só para imagem, vídeo e áudio (memos recentes). */
export function MemoCardMediaMini({ m, apiBase }: Props) {
  if (!memoCardHasAttachment(m)) return null;
  const t = m.mediaType;
  if (t !== "image" && t !== "video" && t !== "audio") return null;

  const fileHref = `${apiBase}/api/memos/${m.id}/file`;
  const publicSrc = resolvePublicMediaSrc(apiBase, m.mediaFileUrl);
  const trySrc = publicSrc || fileHref;

  if (t === "image") {
    return (
      <div className={styles.miniMediaRow}>
        <a
          href={fileHref}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.miniMediaLink}
          title="Abrir imagem"
        >
          <MemoMiniImage src={trySrc} fallback={fileHref} />
        </a>
      </div>
    );
  }

  if (t === "video") {
    return (
      <div className={styles.miniMediaRow}>
        <video
          className={styles.miniVideo}
          src={trySrc}
          controls
          playsInline
          muted
          preload="metadata"
        />
      </div>
    );
  }

  return (
    <div className={styles.miniMediaRow}>
      <div className={styles.miniAudioWrap}>
        <audio className={styles.miniAudio} src={trySrc} controls preload="metadata" />
      </div>
    </div>
  );
}

function MemoMiniImage({ src, fallback }: { src: string; fallback: string }) {
  const [useFallback, setUseFallback] = useState(false);
  return (
    <img
      className={styles.miniImg}
      src={useFallback ? fallback : src}
      alt=""
      loading="lazy"
      onError={() => setUseFallback(true)}
    />
  );
}
