import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PagesApp from "./app";
import "../app/globals.css";
import "./pages.css";

const root = document.getElementById("root");
if (!root) throw new Error("Não foi possível iniciar o painel.");
createRoot(root).render(<StrictMode><PagesApp /></StrictMode>);
