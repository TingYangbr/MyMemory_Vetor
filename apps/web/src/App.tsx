import { Navigate, Route, Routes } from "react-router-dom";
import AdminPage from "./pages/AdminPage";
import AdminDocumentAiPage from "./pages/AdminDocumentAiPage";
import AdminCadPipelinePage from "./pages/AdminCadPipelinePage";
import AdminSystemConfigPage from "./pages/AdminSystemConfigPage";
import AdminLlmPromptPage from "./pages/AdminLlmPromptPage";
import AdminMediaSettingsPage from "./pages/AdminMediaSettingsPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import GroupCreatePage from "./pages/GroupCreatePage";
import GroupJoinPlaceholderPage from "./pages/GroupJoinPlaceholderPage";
import GroupInviteAcceptPage from "./pages/GroupInviteAcceptPage";
import GroupOwnerPanelPage from "./pages/GroupOwnerPanelPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import MemoContextPage from "./pages/MemoContextPage";
import RegisterPage from "./pages/RegisterPage";
import SelectPlanPage from "./pages/SelectPlanPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import MemoSearchPage from "./pages/MemoSearchPage";
import PerguntaPage from "./pages/PerguntaPage";
import MemoEditPage from "./pages/MemoEditPage";
import MemoAudioReviewPage from "./pages/MemoAudioReviewPage";
import MemoVideoReviewPage from "./pages/MemoVideoReviewPage";
import MemoDocumentReviewPage from "./pages/MemoDocumentReviewPage";
import MemoImageReviewPage from "./pages/MemoImageReviewPage";
import MemoTextReviewPage from "./pages/MemoTextReviewPage";
import UserPreferencesPage from "./pages/UserPreferencesPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";

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
      <Route path="/admin/system-config" element={<AdminSystemConfigPage />} />
      <Route path="/admin/llm-prompt" element={<AdminLlmPromptPage />} />
      <Route path="/estrutura-memo" element={<MemoContextPage />} />
      <Route path="/buscar" element={<MemoSearchPage />} />
      <Route path="/perguntar" element={<PerguntaPage />} />
      <Route path="/conta" element={<Navigate to="/conta/preferencias" replace />} />
      <Route path="/conta/preferencias" element={<UserPreferencesPage />} />
      <Route path="/revisao/memo-texto" element={<MemoTextReviewPage />} />
      <Route path="/revisao/memo-imagem" element={<MemoImageReviewPage />} />
      <Route path="/revisao/memo-audio" element={<MemoAudioReviewPage />} />
      <Route path="/revisao/memo-video" element={<MemoVideoReviewPage />} />
      <Route path="/revisao/memo-documento" element={<MemoDocumentReviewPage />} />
      <Route path="/memo/:id/editar" element={<MemoEditPage />} />
      <Route path="/grupo/novo" element={<GroupCreatePage />} />
      <Route path="/grupo/entrar" element={<GroupJoinPlaceholderPage />} />
      <Route path="/grupo/:groupId/painel" element={<GroupOwnerPanelPage />} />
      <Route path="/convite/grupo" element={<GroupInviteAcceptPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
