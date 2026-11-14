import { Navigate, Route, Routes } from "react-router-dom";
import AdminPage from "./pages/AdminPage";
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
import GroupOwnerPanelPage from "./pages/GroupOwnerPanelPage";
import PainelGrupoPage from "./pages/painelGrupo/PainelGrupoPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MemoContextPage from "./pages/MemoContextPage";
import RegisterPage from "./pages/RegisterPage";
import SelectPlanPage from "./pages/SelectPlanPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import PerguntaModelosPage from "./pages/PerguntaModelosPage";
import UserPreferencesPage from "./pages/UserPreferencesPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import BatchImportPage from "./pages/BatchImportPage";
import AdminSubscriptionsPage from "./pages/AdminSubscriptionsPage";
import AdminStoragePage from "./pages/AdminStoragePage";
import AvisosPage from "./pages/AvisosPage";
import RevisarMemoPage from "./pages/RevisarMemoPage";
import EditarMemoNovoPage from "./pages/EditarMemoNovoPage";

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
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/midia" element={<AdminMediaSettingsPage />} />
      <Route path="/admin/documento-ia" element={<AdminDocumentAiPage />} />
      <Route path="/admin/cad-pipeline" element={<AdminCadPipelinePage />} />
      <Route path="/admin/conhecimento" element={<AdminConhecimentoPage />} />
      <Route path="/admin/system-config" element={<AdminSystemConfigPage />} />
      <Route path="/admin/llm-prompt" element={<AdminLlmPromptPage />} />
      <Route path="/admin/assinaturas" element={<AdminSubscriptionsPage />} />
      <Route path="/admin/storage" element={<AdminStoragePage />} />
      <Route path="/estrutura-memo" element={<MemoContextPage />} />
      <Route path="/buscar" element={<Navigate to="/?tab=buscar" replace />} />
      <Route path="/perguntar" element={<Navigate to="/?tab=perguntar" replace />} />
      <Route path="/perguntas-salvas" element={<PerguntaModelosPage />} />
      <Route path="/avisos" element={<AvisosPage />} />
      <Route path="/conta" element={<Navigate to="/conta/preferencias" replace />} />
      <Route path="/conta/preferencias" element={<UserPreferencesPage />} />
      <Route path="/revisao/memo-texto" element={<RevisarMemoPage rota="texto" />} />
      <Route path="/revisao/memo-imagem" element={<RevisarMemoPage rota="imagem" />} />
      <Route path="/revisao/memo-audio" element={<RevisarMemoPage rota="audio" />} />
      <Route path="/revisao/memo-video" element={<RevisarMemoPage rota="video" />} />
      <Route path="/revisao/memo-documento" element={<RevisarMemoPage rota="documento" />} />
      <Route path="/importar-lote" element={<BatchImportPage />} />
      <Route path="/memo/:id/editar" element={<EditarMemoNovoPage />} />
      <Route path="/grupo/novo" element={<GroupCreatePage />} />
      <Route path="/grupo/entrar" element={<GroupJoinPlaceholderPage />} />
      <Route path="/grupo/:groupId/painel" element={<GroupOwnerPanelPage />} />
      <Route path="/grupo/:groupId/admin" element={<PainelGrupoPage />} />
      <Route path="/convite/grupo" element={<GroupInviteAcceptPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
