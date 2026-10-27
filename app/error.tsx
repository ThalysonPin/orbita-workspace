"use client";

export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f6f5f1", color: "#262a2a", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 420 }}>
        <p style={{ color: "#c45a38", fontWeight: 700, letterSpacing: 3 }}>ÓRBITA</p>
        <h1 style={{ fontSize: 32, letterSpacing: -1 }}>Vamos retomar de onde parou.</h1>
        <p style={{ lineHeight: 1.7, color: "#6a706b" }}>Não foi possível carregar o painel. Suas alterações salvas neste navegador continuam aqui.</p>
        <button onClick={reset} style={{ border: 0, borderRadius: 10, padding: "14px 20px", background: "#ef744f", color: "#fff", cursor: "pointer", fontWeight: 600 }}>Tentar novamente</button>
      </section>
    </main>
  );
}
