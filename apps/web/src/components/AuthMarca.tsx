import styles from "../pages/AuthPage.module.css";

/**
 * Painel da marca nas telas de acesso (Entrar, Criar conta, senha, convite) — lote 4 do redesenho.
 * Fica à esquerda no computador e some no celular (só o cartão aparece).
 */
export default function AuthMarca() {
  return (
    <aside className={styles.marca} aria-label="Sobre o proMemory">
      <div className={styles.marcaTopo}>
        <span className={styles.marcaIcone} aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
        </span>
        <span className={styles.marcaNome}>proMemory</span>
      </div>
      <div className={styles.marcaCorpo}>
        <h2 className={styles.marcaTitulo}>O assistente profissional para a sua memória</h2>
        <p className={styles.marcaTexto}>
          Com o proMemory, você pode fazer perguntas sobre suas informações, registrar o que aconteceu e acompanhar suas
          agendas, despesas e outros controles do dia a dia. Basta escrever ou falar do seu jeito. Você também pode enviar
          fotos e documentos. Tudo pelo celular ou notebook, onde estiver e a qualquer hora.
        </p>
        <p className={styles.marcaEmpresa}>Na versão empresarial, você pode consultar os dados do ERP da sua empresa.</p>
      </div>
      <p className={styles.marcaRodape}>Softing · desde 1984</p>
    </aside>
  );
}
