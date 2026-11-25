import { useState } from "react";
import type { ExemplosCategoria } from "@mymemory/shared";

/**
 * Painel do botão 💡 Exemplos do Fale comigo: frases prontas das categorias habilitadas no grupo. Tocar numa frase
 * a coloca na caixa (não envia). Primeiro a frase principal de cada categoria; "Ver mais" mostra todas.
 */
export function ExemplosFaleComigo({
  exemplos,
  onEscolher,
  onFechar,
  onNaoMostrar,
}: {
  exemplos: ExemplosCategoria[];
  onEscolher: (frase: string) => void;
  onFechar: () => void;
  onNaoMostrar: () => void;
}) {
  const [todos, setTodos] = useState(false);
  const temMais = exemplos.some((e) => e.frases.length > 1);

  const chip: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    margin: "4px 0",
    border: "1px solid var(--mm-border)",
    borderRadius: 10,
    background: "var(--mm-card)",
    color: "inherit",
    font: "inherit",
    fontSize: 14,
    cursor: "pointer",
  };
  const link: React.CSSProperties = {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--mm-primary, #0d9488)",
    font: "inherit",
    fontSize: 13,
    cursor: "pointer",
    textDecoration: "underline",
  };

  return (
    <div
      role="region"
      aria-label="Exemplos do que você pode dizer"
      style={{ marginTop: 10, padding: "10px 12px", border: "1px solid var(--mm-border)", borderRadius: 12, background: "var(--mm-bg, transparent)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>💡 Experimente dizer</strong>
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...link, textDecoration: "none", fontSize: 18, lineHeight: 1 }} onClick={onFechar} aria-label="Fechar exemplos">
          ×
        </button>
      </div>
      <p style={{ margin: "2px 0 6px", fontSize: 12.5, color: "var(--mm-muted)" }}>
        Toque numa frase: ela vai para a caixa, para você ajustar e enviar.
      </p>
      {todos
        ? exemplos.map((ex) => (
            <div key={ex.titulo} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mm-muted)", textTransform: "uppercase", letterSpacing: 0.3 }}>{ex.titulo}</div>
              {ex.frases.map((f) => (
                <button key={f} type="button" style={chip} onClick={() => onEscolher(f)}>
                  “{f}”
                </button>
              ))}
            </div>
          ))
        : exemplos.map((ex) => (
            <button key={ex.titulo} type="button" style={chip} onClick={() => onEscolher(ex.frases[0]!)} title={ex.titulo}>
              “{ex.frases[0]}” <span style={{ color: "var(--mm-muted)", fontSize: 12 }}>· {ex.titulo}</span>
            </button>
          ))}
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        {temMais ? (
          <button type="button" style={link} onClick={() => setTodos((v) => !v)}>
            {todos ? "Ver menos" : "Ver mais exemplos"}
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...link, color: "var(--mm-muted)" }} onClick={onNaoMostrar}>
          Não mostrar mais
        </button>
      </div>
    </div>
  );
}
