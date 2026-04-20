import Header from "../components/Header";
import styles from "./GroupFlowPlaceholder.module.css";
export default function GroupJoinPlaceholderPage() {
  return (
    <>
      <Header />
      <div className={styles.shell}>
        <h1 className={styles.title}>Entrar em outro grupo</h1>
        <p className={styles.text}>
          Aqui será o campo para introduzir o código de acesso do grupo ou seguir um convite por e-mail (token na
          tabela <code>email_invites</code>).
        </p>
      </div>
    </>
  );
}
