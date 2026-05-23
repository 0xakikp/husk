import { TerminalView } from "./Terminal";
import "./App.css";

function App() {
  return (
    <div className="app">
      <header className="titlebar">
        <img src="/logo.png" className="titlebar-logo" alt="huskv2" />
        <span className="titlebar-title">huskv2</span>
      </header>
      <TerminalView />
    </div>
  );
}

export default App;
