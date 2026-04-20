import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { MemoRecentCard } from "@mymemory/shared";
import {
  attachmentExt,
  memoCardHasAttachment,
  resolvePublicMediaSrc,
  searchCardPrimaryLabel,
} from "../memo/memoCardDisplayUtils";
import styles from "./RecentMemos.module.css";

function memoAttachmentExtLower(m: MemoRecentCard): string {
  const fromUrl = attachmentExt(m.mediaFileUrl);
  if (fromUrl) return fromUrl;
  const n = m.attachmentDisplayName?.trim();
  if (n && n.includes(".")) return n.slice(n.lastIndexOf(".") + 1).toLowerCase();
  return "";
}

function PreviewImage({ trySrc, fileHref }: { trySrc: string; fileHref: string }) {
  const [useFallback, setUseFallback] = useState(false);
  return (
    <img
      className={styles.previewImg}
      src={useFallback ? fileHref : trySrc}
      alt=""
      onError={() => setUseFallback(true)}
    />
  );
}

export function MemoFilePreviewModal({
  m,
  apiBase,
  returnTo,
  onClose,
}: {
  m: MemoRecentCard;
  apiBase: string;
  returnTo: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const fileHref = `${apiBase}/api/memos/${m.id}/file`;
  const publicSrc = resolvePublicMediaSrc(apiBase, m.mediaFileUrl);
  const trySrc = publicSrc || fileHref;
  const label = searchCardPrimaryLabel(m);

  let body: ReactNode;
  if (m.mediaType === "image" && memoCardHasAttachment(m)) {
    body = <PreviewImage trySrc={trySrc} fileHref={fileHref} />;
  } else if (m.mediaType === "video" && memoCardHasAttachment(m)) {
    body = <video className={styles.previewVideo} src={trySrc} controls playsInline preload="metadata" />;
  } else if (m.mediaType === "audio" && memoCardHasAttachment(m)) {
    body = <audio className={styles.previewAudio} src={trySrc} controls preload="metadata" />;
  } else if (m.mediaType === "document" && memoCardHasAttachment(m)) {
    const ext = memoAttachmentExtLower(m);
    const isPdf = ext === "pdf";
    body = (
      <div className={styles.previewDocWrap}>
        {isPdf ? (
          <>
            <p className={styles.previewDocHint}>
              <a href={fileHref} target="_blank" rel="noopener noreferrer" className={styles.previewDocLink}>
                Abrir PDF em outra aba
              </a>
            </p>
            <iframe className={styles.previewFrame} src={fileHref} title={label} />
          </>
        ) : (
          <>
            <div className={styles.previewWhyBox}>
              <p className={styles.previewWhyTitle}>Por que .doc e .msg não abrem aqui dentro da página?</p>
              <p className={styles.previewWhyText}>
                O navegador consegue mostrar na própria aba coisas como <strong>imagem</strong>, <strong>vídeo</strong>,{" "}
                <strong>áudio</strong> e, em geral, <strong>PDF</strong>. Já <strong>.doc</strong> e <strong>.msg</strong>{" "}
                são formatos <strong>binários</strong> do Word/Outlook — não existe um “Word mini” ou “Outlook mini”
                embutido no Chrome, Edge ou Firefox, então o site <strong>não consegue desenhar</strong> o conteúdo
                formatado no meio da página como no aplicativo.
              </p>
            </div>
            <p className={styles.previewDocLead}>
              Use o botão abaixo para abrir em <strong>outra aba</strong>. O servidor envia o <strong>arquivo</strong> com
              cabeçalho <code>inline</code> e tipo MIME correto (.msg, .doc, etc.), para o sistema poder oferecer o{" "}
              <strong>Outlook</strong>, <strong>Word</strong> ou outro <strong>aplicativo padrão</strong> associado à
              extensão.
            </p>
            <a
              href={fileHref}
              target="_blank"
              rel="noopener noreferrer"
              className={`mm-btn mm-btn--primary ${styles.previewOpenAppBtn}`}
            >
              Abrir arquivo (aplicativo padrão)
            </a>
            <p className={styles.previewDocFootnote}>
              Se o navegador ainda salvar na pasta de <strong>Downloads</strong>, associe a extensão ao Word/Outlook nas
              configurações do Windows ou use <strong>Abrir com</strong> no arquivo baixado.
            </p>
          </>
        )}
      </div>
    );
  } else if (m.mediaType === "url") {
    const htmlHref = m.mediaFileUrl?.trim() ? fileHref : null;
    const webHref = m.mediaWebUrl?.trim() || null;
    body = (
      <div className={styles.previewUrlBox}>
        {htmlHref ? (
          <p className={styles.previewUrlLine}>
            <a href={htmlHref} target="_blank" rel="noopener noreferrer">
              Abrir página HTML arquivada
            </a>
          </p>
        ) : null}
        {webHref ? (
          <p className={styles.previewUrlLine}>
            <a href={webHref} target="_blank" rel="noopener noreferrer">
              Abrir URL original
            </a>
          </p>
        ) : null}
        {!htmlHref && !webHref ? <p className="mm-muted">Sem arquivo ou URL associada.</p> : null}
      </div>
    );
  } else {
    body = (
      <p className="mm-muted">
        Não há arquivo para mostrar aqui.{" "}
        <Link to={`/memo/${m.id}/editar`} state={{ returnTo }} onClick={onClose}>
          Abrir memo
        </Link>
      </p>
    );
  }

  return (
    <div className="mm-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className={`mm-modal ${styles.filePreviewModal}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.filePreviewHead}>
          <h3 id={titleId} className={styles.filePreviewTitle}>
            {label}
          </h3>
          <button type="button" className={styles.filePreviewClose} onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className={styles.filePreviewBody}>{body}</div>
        <div className={styles.filePreviewFoot}>
          <Link to={`/memo/${m.id}/editar`} state={{ returnTo }} className="mm-btn mm-btn--ghost" onClick={onClose}>
            Editar memo
          </Link>
        </div>
      </div>
    </div>
  );
}
