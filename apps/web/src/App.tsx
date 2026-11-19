import { Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import AdminPage from "./pages/AdminPage";
import AdminLayout from "./components/AdminLayout";
import AdminDocumentAiPage from "./pages/AdminDocumentAiPage";
import AdminCadPipelinePage from "./pages/AdminCadPipelinePage";
import AdminConhecimentoPage from "./pages/AdminConhecimentoPage";
import AdminSystemConfigPage from "./pages/AdminSystemConfigPage";
import AdminLlmPromptPage from "./pages/AdminLlmPromptPage";
import AdminMediaSettingsPage from "./pages/AdminMediaSettingsPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import GroupCreatePage from "./pages/GroupCreatePage";
import GroupJoinPlaceholderPage from "./pages/GroupJoinPlaceholderPage";
import GroupInviteAcceptPage from "./pages/GroupInviteAcceptPage";
import PainelGrupoPage from "./pages/painelGrupo/PainelGrupoPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import SelectPlanPage from "./pages/SelectPlanPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import UserPreferencesPage from "./pages/UserPreferencesPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import AdminSubscriptionsPage from "./pages/AdminSubscriptionsPage";
import AdminStoragePage from "./pages/AdminStoragePage";
import RevisarMemoPage from "./pages/RevisarMemoPage";
import EditarMemoNovoPage from "./pages/EditarMemoNovoPage";
import AvisosNovoPage from "./pages/acompanhar/AvisosNovoPage";
import PerguntasSalvasNovoPage from "./pages/acompanhar/PerguntasSalvasNovoPage";
import ImportarLoteNovoPage from "./pages/acompanhar/ImportarLoteNovoPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/select-plan" element={<SelectPlanPage />} />
      <Route path="/cadastro" element={<RegisterPage />} />
      <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route path="/verificar-email" element={<VerifyEmailPage />} />
      <Route path="/admin" element={<AdminLayout><AdminPage /></AdminLayout>} />
      <Route path="/admin/:secao" element={<AdminLayout><AdminPage /></AdminLayout>} />
      <Route path="/admin/midia" element={<AdminLayout><AdminMediaSettingsPage /></AdminLayout>} />
      <Route path="/admin/documento-ia" element={<AdminLayout><AdminDocumentAiPage /></AdminLayout>} />
      <Route path="/admin/cad-pipeline" element={<AdminLayout><AdminCadPipelinePage /></AdminLayout>} />
      <Route path="/admin/conhecimento" element={<AdminLayout><AdminConhecimentoPage /></AdminLayout>} />
      <Route path="/admin/system-config" element={<AdminLayout><AdminSystemConfigPage /></AdminLayout>} />
      <Route path="/admin/llm-prompt" element={<AdminLayout><AdminLlmPromptPage /></AdminLayout>} />
      <Route path="/admin/assinaturas" element={<AdminLayout><AdminSubscriptionsPage /></AdminLayout>} />
      <Route path="/admin/storage" element={<AdminLayout><AdminStoragePage /></AdminLayout>} />
      <Route path="/estrutura-memo" element={<EstruturaAntigaRedirect />} />
      <Route path="/buscar" element={<Navigate to="/?tab=buscar" replace />} />
      <Route path="/perguntar" element={<Navigate to="/?tab=perguntar" replace />} />
      <Route path="/perguntas-salvas" element={<PerguntasSalvasNovoPage />} />
      <Route path="/avisos" element={<AvisosNovoPage />} />
      <Route path="/conta" element={<Navigate to="/conta/preferencias" replace />} />
      <Route path="/conta/preferencias" element={<UserPreferencesPage />} />
      <Route path="/revisao/memo-texto" element={<RevisarMemoPage rota="texto" />} />
      <Route path="/revisao/memo-imagem" element={<RevisarMemoPage rota="imagem" />} />
      <Route path="/revisao/memo-audio" element={<RevisarMemoPage rota="audio" />} />
      <Route path="/revisao/memo-video" element={<RevisarMemoPage rota="video" />} />
      <Route path="/revisao/memo-documento" element={<RevisarMemoPage rota="documento" />} />
      <Route path="/importar-lote" element={<ImportarLoteNovoPage />} />
      {/* Endereços usados durante o teste do lote 3 */}
      <Route path="/acompanhar/avisos" element={<Navigate to="/avisos" replace />} />
      <Route path="/acompanhar/perguntas-salvas" element={<Navigate to="/perguntas-salvas" replace />} />
      <Route path="/acompanhar/importar-lote" element={<Navigate to="/importar-lote" replace />} />
      <Route path="/memo/:id/editar" element={<EditarMemoNovoPage />} />
      <Route path="/grupo/novo" element={<GroupCreatePage />} />
      <Route path="/grupo/entrar" element={<GroupJoinPlaceholderPage />} />
      <Route path="/grupo/:groupId/painel" element={<PainelAntigoRedirect />} />
      <Route path="/grupo/:groupId/admin" element={<PainelGrupoPage />} />
      <Route path="/convite/grupo" element={<GroupInviteAcceptPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Endereço antigo do painel do grupo: abre o painel novo. */
function PainelAntigoRedirect() {
  const { groupId } = useParams<{ groupId: string }>();
  return <Navigate to={`/grupo/${groupId}/admin`} replace />;
}

/** Endereço antigo da Estrutura contextual: abre as Categorias do painel novo. */
function EstruturaAntigaRedirect() {
  const [sp] = useSearchParams();
  const gid = sp.get("ownerGroupId") ?? sp.get("groupId");
  return <Navigate to={`/grupo/${gid && /^\d+$/.test(gid) ? gid : "globais"}/admin?secao=categorias`} replace />;
}
