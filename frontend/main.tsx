import { createRoot } from "react-dom/client";
import OntologyStudio from "./app/OntologyStudio";
import "./app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("找不到应用挂载节点 #root");
}

createRoot(root).render(<OntologyStudio />);
