import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../utils/api";
import PageNav from "../components/PageNav";

function Page({ children }) {
  return (
    <div className="site-page">
      <PageNav />
      <main className="page-container">{children}</main>
    </div>
  );
}

function DeliverablesHistoryPage() {
  const [deliverables, setDeliverables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    api.getDeliverables()
      .then((data) => {
        if (active) {
          setDeliverables(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load deliverables:", err);
        if (active) {
          setError("Failed to fetch deliverables from the server.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const formatBytes = (bytes) => {
    if (!bytes) return "Unknown size";
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <Page>
      <div className="page-title">
        <span>05 — DELIVERABLES HISTORY</span>
        <h1>Project Deliverables</h1>
        <p>The complete archive of all presentations, plans, and files published over the lifecycle of the project.</p>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "40px" }}>
          <div className="spinner"></div>
          <p style={{ marginTop: "15px", color: "#55748a" }}>Loading deliverables archive...</p>
        </div>
      )}

      {error && (
        <div className="alert error" style={{ maxWidth: "800px", margin: "0 auto 40px" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!loading && !error && deliverables.length === 0 && (
        <div style={{
          maxWidth: "800px",
          margin: "0 auto",
          padding: "60px 40px",
          background: "#edf7fb",
          borderRadius: "15px",
          border: "1px solid #c7e0ec",
          textAlign: "center"
        }}>
          <h2 style={{ color: "#07162d", marginBottom: "10px" }}>No Deliverables Published Yet</h2>
          <p style={{ color: "#55748a", marginBottom: "25px" }}>The team has not uploaded any official project deliverables to the server yet.</p>
          <Link to="/planning-v1" className="primary-btn" style={{ display: "inline-block", textDecoration: "none" }}>
            View Planning Presentation V1 (Interactive)
          </Link>
        </div>
      )}

      {!loading && !error && deliverables.length > 0 && (
        <div style={{ maxWidth: "1000px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "25px" }}>
          {deliverables.map((item) => (
            <div key={item.id} style={{
              background: "#ffffff",
              border: "1px solid #c8e1ec",
              borderRadius: "16px",
              padding: "30px",
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              boxShadow: "0 4px 6px rgba(7, 22, 45, 0.02)",
              transition: "transform 0.2s, box-shadow 0.2s"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "15px" }}>
                <div>
                  <span style={{
                    display: "inline-block",
                    background: "#edf7fb",
                    color: "#286987",
                    fontSize: "11px",
                    fontWeight: "800",
                    padding: "4px 10px",
                    borderRadius: "20px",
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                    marginBottom: "10px"
                  }}>
                    {item.deliverable_type} • Version {item.version}
                  </span>
                  <h2 style={{ margin: 0, color: "#07162d", fontSize: "24px" }}>{item.title}</h2>
                </div>

                <div style={{ textAlign: "right", fontSize: "14px", color: "#55748a" }}>
                  <div><strong>Presented:</strong> {item.presentation_date}</div>
                  <div style={{ fontSize: "12px", marginTop: "4px" }}>Published: {new Date(item.published_at).toLocaleDateString()}</div>
                </div>
              </div>

              <div style={{ borderTop: "1px solid #edf2f5", paddingTop: "15px", display: "grid", gridTemplateColumns: "1fr", gap: "15px" }}>
                <div>
                  <h4 style={{ margin: "0 0 5px", color: "#286987", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Authors</h4>
                  <p style={{ margin: 0, color: "#07162d", fontSize: "15px" }}>{item.authors}</p>
                </div>

                {item.change_summary && (
                  <div>
                    <h4 style={{ margin: "0 0 5px", color: "#286987", fontSize: "13px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Change Log / Description</h4>
                    <p style={{ margin: 0, color: "#42647d", fontSize: "15px", lineHeight: "1.5" }}>{item.change_summary}</p>
                  </div>
                )}
              </div>

              <div style={{
                borderTop: "1px solid #edf2f5",
                paddingTop: "20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "15px"
              }}>
                <span style={{ fontSize: "13px", color: "#55748a" }}>
                  <strong>File name:</strong> {item.original_filename || "N/A"} ({formatBytes(item.file_size_bytes)})
                </span>

                <div style={{ display: "flex", gap: "12px" }}>
                  <Link to={`/${item.slug}`} className="primary-btn" style={{
                    textDecoration: "none",
                    padding: "10px 20px",
                    fontSize: "14px",
                    fontWeight: "bold",
                    background: "#07162d",
                    color: "#ffffff"
                  }}>
                    Open Preview
                  </Link>
                  <a href={item.file_url} download target="_blank" rel="noopener noreferrer" className="secondary-btn" style={{
                    textDecoration: "none",
                    padding: "10px 20px",
                    fontSize: "14px",
                    fontWeight: "bold",
                    border: "1px solid #07162d",
                    color: "#07162d",
                    background: "transparent"
                  }}>
                    Download File
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

export default DeliverablesHistoryPage;
