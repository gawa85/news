import { createContext, type ReactNode } from "react";

/** La ayuda de la pantalla actual ("¿Cómo se usa esta pantalla?"): la elige el esqueleto y la muestra Page. */
export const PageHelpSlot = createContext<ReactNode>(null);
