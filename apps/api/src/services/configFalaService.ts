/**
 * Configurações da conta pelo Fale comigo ("como desabilito o autofalante?", "fala mais devagar", "tira os exemplos"):
 * a resposta explica e OFERECE a mudança (botões Sim/Não); nada muda sem o toque. Só preferências que não mexem em
 * custo, dados ou permissões: voz ligada, velocidade da voz, exemplos 💡 e abrir o PDF numa aba. Detecção por regra
 * (sem IA), só em frase curta sobre o app — "quanto gastei com som?" não dispara.
 */
import type { AcaoConfig } from "@mymemory/shared";
import type { RowDataPacket } from "../lib/dbTypes.js";
import { pool } from "../db.js";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

interface Prefs {
  voz: boolean;
  velocidade: number;
  exemplos: number;
  pdfAba: boolean;
}

async function lerPrefs(userId: number): Promise<Prefs> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT soundenabled AS "voz", ttsrate AS "vel", exemplos_fale_comigo AS "ex", pdf_abrir_aba AS "pdf" FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  const r = rows[0] ?? {};
  const vel = Number(r.vel);
  return {
    voz: r.voz === true || Number(r.voz) === 1,
    velocidade: Number.isFinite(vel) && vel >= 0.5 && vel <= 2 ? vel : 1,
    exemplos: Number(r.ex ?? 1),
    pdfAba: Number(r.pdf ?? 0) === 1,
  };
}

/** Velocidade só conta falando da voz/leitura. */
const VOZ = /\b(som|voz|audio|autofalante|alto-?falante|narra\w*|leitura|ler|fala|fale|falar|falando)\b/;
/** Palavra da voz logo depois do verbo ("desligar o som", "ligar a voz"): "ligar para o Carlos" não conta. */
const ALVO_VOZ = String.raw`\s+(?:o |a |os |as |do |da |de |de novo |minha |meu )*(?:som|voz|audio|autofalante|alto-?falante|narracao|leitura)\b`;
const VOZ_OFF = new RegExp(
  String.raw`\b(?:deslig\w*|desabilit\w*|desativ\w*|tira\w*|tirar|remov\w*|silenci\w*|mut\w*|cort\w*)` +
    ALVO_VOZ +
    String.raw`|\b(?:para|parar|pare) de (?:falar|ler|narrar)\b|\b(?:sem som|sem voz|modo silencioso|nao quero ouvir|nao fale)\b`
);
const VOZ_ON = new RegExp(
  String.raw`\b(?:lig\w*|habilit\w*|ativ\w*|religa\w*|volta\w*)` +
    ALVO_VOZ +
    String.raw`|\bquero ouvir (?:as )?respostas\b|\b(?:ler|leia) as respostas em voz alta\b`
);

const fmtVel = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}×`;

/** Pedido de configuração reconhecido: o texto da resposta e a ação oferecida (ou só o texto, se já está assim). */
export async function configuracaoPelaFrase(frase: string, userId: number): Promise<{ texto: string; acao: AcaoConfig | null } | null> {
  const t = norm(frase).replace(/[?!.]+$/, "");
  if (t.length > 90) return null;
  // Frase sobre dados (valores, gastos, memos) não é configuração
  if (/\b(quanto|gast\w*|pagu\w*|r\$|reais|memo|lista de|agenda|reuniao|loja|comprei|compra)\b/.test(t)) return null;

  const ehVoz = VOZ.test(t);
  const ehVolume = /\b(volume|mais alto|aumenta\w* o som|aumentar o som|abaixa\w* o som|baixa\w* o som|baixo demais|nao (estou )?ouvindo|nao escuto|nao ouco)\b/.test(t);
  const ehVelocidade = /\b(velocidade|mais rapid\w*|acelera\w*|mais devagar|devagar|mais lent\w*|lento demais|rapido demais)\b/.test(t) && (ehVoz || /velocidade/.test(t));
  const ehExemplos = /\bexemplos?\b/.test(t) && !/\bde exemplos?\b.*\b(gast|pag)/.test(t);
  const ehPdf = /\bpdf\b/.test(t) && /\b(aba|abrir|abre|baix\w*|download|salvar)\b/.test(t);
  const ehLigaDesliga = VOZ_OFF.test(t) || VOZ_ON.test(t);
  if (!ehLigaDesliga && !ehVolume && !ehVelocidade && !ehExemplos && !ehPdf) return null;

  const p = await lerPrefs(userId);

  if (ehVolume) {
    const base =
      "O volume é o do aparelho: use as teclas de volume (e confira se o celular ou o computador não está no mudo). " +
      "A voz do proMemory já sai no volume máximo que o navegador permite.";
    if (!p.voz) {
      return {
        texto: `${base} A voz está desligada: as respostas não são lidas em voz alta. Quer que eu ligue?`,
        acao: { chave: "soundEnabled", valor: true, rotulo: "Sim, ligar a voz", feito: "Voz ligada: as próximas respostas serão lidas em voz alta." },
      };
    }
    return { texto: base, acao: null };
  }

  if (ehVelocidade) {
    const m = /(\d+(?:[.,]\d+)?)/.exec(t);
    const pedido = m ? Number(m[1].replace(",", ".")) : null;
    const mais = /\b(mais rapid\w*|acelera\w*|lento demais)\b/.test(t);
    const menos = /\b(mais devagar|devagar|mais lent\w*|rapido demais)\b/.test(t);
    let alvo = pedido != null && pedido >= 0.5 && pedido <= 2 ? pedido : mais ? p.velocidade + 0.25 : menos ? p.velocidade - 0.25 : null;
    if (alvo == null) {
      return {
        texto: `A velocidade da voz está em ${fmtVel(p.velocidade)}. Diga "fala mais rápido", "fala mais devagar" ou "velocidade 1,5" (de 0,5× a 2,0×), ou mude em Preferências → Velocidade da voz.`,
        acao: null,
      };
    }
    alvo = Math.round(Math.min(2, Math.max(0.5, alvo)) * 100) / 100;
    if (alvo === p.velocidade) {
      return { texto: `A velocidade da voz já está em ${fmtVel(alvo)}${alvo >= 2 ? " (a mais rápida)" : alvo <= 0.5 ? " (a mais lenta)" : ""}.`, acao: null };
    }
    return {
      texto: `A velocidade da voz está em ${fmtVel(p.velocidade)}. Quer que eu mude para ${fmtVel(alvo)}?` + (p.voz ? "" : " (A voz está desligada; a velocidade vale quando ligar.)"),
      acao: { chave: "ttsRate", valor: alvo, rotulo: `Sim, mudar para ${fmtVel(alvo)}`, feito: `Velocidade da voz: ${fmtVel(alvo)}.` },
    };
  }

  if (ehExemplos) {
    const desligar = /\b(deslig\w*|desabilit\w*|desativ\w*|tira\w*|tirar|remov\w*|esconde\w*|ocult\w*|some\w*)\b/.test(t);
    const ligar = !desligar && /\b(mostr\w*|exib\w*|lig\w*|volta\w*|ver)\b/.test(t);
    if (!desligar && !ligar) return null;
    if (desligar) {
      if (p.exemplos === 0) return { texto: "Os exemplos 💡 já estão desligados.", acao: null };
      return {
        texto: "O botão 💡 Exemplos mostra frases prontas das categorias do grupo. Quer que eu tire o botão?",
        acao: { chave: "exemplosFaleComigo", valor: 0, rotulo: "Sim, tirar os exemplos", feito: 'Exemplos desligados. Para ligar de novo: diga "mostrar os exemplos" ou Preferências → Mostrar exemplos no Fale comigo.' },
      };
    }
    if (p.exemplos !== 0) return { texto: "Os exemplos já estão ligados: toque em 💡 Exemplos, ao lado de Perguntas salvas.", acao: null };
    return {
      texto: "Os exemplos 💡 estão desligados. Quer que eu ligue o botão de novo?",
      acao: { chave: "exemplosFaleComigo", valor: 1, rotulo: "Sim, mostrar os exemplos", feito: "Exemplos ligados: toque em 💡 Exemplos, ao lado de Perguntas salvas." },
    };
  }

  if (ehPdf) {
    const aba = /\b(aba|abrir|abre)\b/.test(t) && !/\b(baix\w*|download|salvar)\b/.test(t);
    if (aba === p.pdfAba) return { texto: aba ? "O PDF da resposta já abre numa aba nova." : "O PDF da resposta já é baixado como arquivo.", acao: null };
    return {
      texto: aba ? "Hoje o PDF da resposta é baixado como arquivo. Quer que ele abra numa aba nova?" : "Hoje o PDF da resposta abre numa aba nova. Quer que ele seja baixado como arquivo?",
      acao: {
        chave: "pdfAbrirAba",
        valor: aba,
        rotulo: aba ? "Sim, abrir numa aba" : "Sim, baixar o arquivo",
        feito: aba ? "Pronto: o PDF vai abrir numa aba nova." : "Pronto: o PDF vai ser baixado como arquivo.",
      },
    };
  }

  // Voz: desligar ou ligar (OFF antes de ON: "desligar" contém "lig")
  const desligar = VOZ_OFF.test(t);
  const ligar = !desligar && VOZ_ON.test(t);
  if (!desligar && !ligar) return null;
  if (desligar) {
    if (!p.voz) return { texto: "A voz já está desligada: as respostas não são lidas em voz alta.", acao: null };
    return {
      texto: "A voz está ligada: as respostas são lidas em voz alta. Quer que eu desligue? (Para parar só a resposta que está sendo lida, toque no 🔊 do card.)",
      acao: { chave: "soundEnabled", valor: false, rotulo: "Sim, desligar a voz", feito: 'Voz desligada. Para ligar de novo: diga "ligar a voz" ou Preferências → Voz ligada.' },
    };
  }
  if (p.voz) return { texto: "A voz já está ligada: as respostas são lidas em voz alta. O 🔊 de cada card lê de novo ou para a leitura.", acao: null };
  return {
    texto: "A voz está desligada. Quer que eu ligue? As respostas passam a ser lidas em voz alta.",
    acao: { chave: "soundEnabled", valor: true, rotulo: "Sim, ligar a voz", feito: "Voz ligada: as próximas respostas serão lidas em voz alta." },
  };
}
