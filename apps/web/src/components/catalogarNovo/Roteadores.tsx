import type { ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { definirTelasNovas, usarTelasNovas } from "../../lib/revisaoNova";
import RevisarMemoPage, { type RotaRevisao } from "../../pages/RevisarMemoPage";
import EditarMemoNovoPage from "../../pages/EditarMemoNovoPage";

/**
 * Lote 2: as telas novas de revisão e de edição ficam ao lado das antigas, no mesmo endereço.
 * Quem liga "Experimentar a nova tela" passa a ver as novas (guardado neste navegador).
 */
function BotaoExperimentar({ onClick, texto }: { onClick: () => void; texto: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 30,
        border: 0,
        borderRadius: 999,
        padding: "10px 16px",
        background: "var(--mm-primary)",
        color: "#fff",
        fontWeight: 700,
        fontSize: 13.5,
        boxShadow: "var(--mm-shadow-lg)",
        cursor: "pointer",
      }}
    >
      ✦ {texto}
    </button>
  );
}

export function RevisaoEscolha({ rota, Antiga }: { rota: RotaRevisao; Antiga: ComponentType }) {
  const location = useLocation();
  const navigate = useNavigate();
  if (usarTelasNovas()) return <RevisarMemoPage rota={rota} />;
  // Documento: a revisão antiga já processou o arquivo; trocar agora processaria de novo
  if (rota === "documento") return <Antiga />;
  const experimentar = () => {
    definirTelasNovas(true);
    navigate(location.pathname, { replace: true, state: { ...(location.state as object), semDecisao: true } });
  };
  return (
    <>
      <Antiga />
      <BotaoExperimentar onClick={experimentar} texto="Experimentar a nova revisão" />
    </>
  );
}

export function EdicaoEscolha({ Antiga }: { Antiga: ComponentType }) {
  const location = useLocation();
  const navigate = useNavigate();
  if (usarTelasNovas()) return <EditarMemoNovoPage />;
  return (
    <>
      <Antiga />
      <BotaoExperimentar
        onClick={() => {
          definirTelasNovas(true);
          navigate(location.pathname + location.search, { replace: true, state: location.state });
        }}
        texto="Experimentar a nova tela de edição"
      />
    </>
  );
}
