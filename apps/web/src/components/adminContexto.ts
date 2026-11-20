import { createContext, useContext } from "react";

/** true = a tela está dentro da moldura do Admin do sistema (AdminLayout), que já mostra o cabeçalho. */
export const EmbutidoNoAdmin = createContext(false);
export const useEmbutidoNoAdmin = () => useContext(EmbutidoNoAdmin);
